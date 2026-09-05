// Gmail helpers shared by gmail-auth, gmail-send, gmail-poll and the senders (supplier-confirm, transport-request, send-messages).
// Tokens: connectors.secret holds the Google refresh token; access tokens are fetched per call and never stored.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { json } from "./auth.ts";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

/** Read a required env var or throw a clear JSON 500 naming it. */
export function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw json({ error: `missing ${name}`, hint: `Run: supabase secrets set ${name}=... --project-ref tylttoheoazyvbuixrrk (see docs/features/gmail-setup.md)` }, 500);
  return v;
}

export type GmailConnector = { id: string; operator_id: string; secret: string | null; config: { email?: string; history_id?: string; last_poll_at?: string; label_ids?: string[] } };

export async function getGmailConnector(db: SupabaseClient, operatorId: string): Promise<GmailConnector | null> {
  const { data } = await db.from("connectors").select("id, operator_id, secret, config").eq("operator_id", operatorId).eq("kind", "gmail").maybeSingle();
  return data && data.secret ? (data as GmailConnector) : null;
}

/** Exchange the stored refresh token for a short-lived access token. */
export async function accessToken(refreshToken: string): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: requireEnv("GOOGLE_CLIENT_ID"), client_secret: requireEnv("GOOGLE_CLIENT_SECRET"), refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`Google token refresh failed: ${j.error_description ?? j.error ?? r.status}. The operator may need to reconnect Gmail.`);
  return j.access_token as string;
}

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function b64urlDecode(s: string): string {
  const b = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  try { return decodeURIComponent(escape(atob(b))); } catch { return atob(b); }
}

export type SendArgs = { from: string; to: string; subject: string; text: string; inReplyTo?: string; threadId?: string };

/** Send a plain-text RFC 2822 message via the Gmail API. Returns Gmail's message id and thread id. */
export async function gmailSend(refreshToken: string, a: SendArgs): Promise<{ id: string; thread_id: string }> {
  const token = await accessToken(refreshToken);
  const headers = [`From: ${a.from}`, `To: ${a.to}`, `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(a.subject)))}?=`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 8bit"];
  if (a.inReplyTo) headers.push(`In-Reply-To: ${a.inReplyTo}`, `References: ${a.inReplyTo}`);
  const raw = b64url(headers.join("\r\n") + "\r\n\r\n" + a.text);
  const body: Record<string, string> = { raw }; if (a.threadId) body.threadId = a.threadId;
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`Gmail send failed: ${j.error?.message ?? r.status}`);
  return { id: j.id, thread_id: j.threadId };
}

export type ParsedMessage = { id: string; thread_id: string; from_email: string; subject: string; snippet: string; body_text: string; received_at: string; message_id_header: string | null };

export async function gmailList(token: string, q: string, max = 50): Promise<string[]> {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(`Gmail list failed: ${j.error?.message ?? r.status}`);
  return (j.messages ?? []).map((m: { id: string }) => m.id);
}

export async function gmailGet(token: string, id: string): Promise<ParsedMessage> {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(`Gmail get failed: ${j.error?.message ?? r.status}`);
  const hdr = (n: string) => (j.payload?.headers ?? []).find((h: { name: string }) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
  let text = ""; let html = "";
  const walk = (p: any) => { if (!p) return; if (p.mimeType === "text/plain" && p.body?.data) text += b64urlDecode(p.body.data); else if (p.mimeType === "text/html" && p.body?.data) html += b64urlDecode(p.body.data); for (const c of p.parts ?? []) walk(c); };
  walk(j.payload);
  if (!text && html) text = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  // Drop quoted history so the matcher reads only the new reply.
  text = text.split(/\r?\n(?:On .{0,120}wrote:|-{2,}\s*Original Message|From: .+)\r?\n/i)[0].split(/\r?\n>/)[0].trim();
  const from = (hdr("From").match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? "").toLowerCase();
  return { id: j.id, thread_id: j.threadId, from_email: from, subject: hdr("Subject"), snippet: j.snippet ?? "", body_text: text.slice(0, 20000), received_at: new Date(Number(j.internalDate)).toISOString(), message_id_header: hdr("Message-ID") || null };
}

/**
 * Send an operational email for an operator, preferring Gmail (their own address), then Resend, else null (caller marks manual).
 * Returns which route was used so the caller can store thread ids and notes.
 */
export async function sendOperatorEmail(db: SupabaseClient, operatorId: string, opSettings: any, a: { to: string; subject: string; text: string; threadId?: string }): Promise<{ via: "gmail" | "resend"; id: string | null; thread_id: string | null } | null> {
  const g = await getGmailConnector(db, operatorId);
  if (g?.config?.email) {
    const r = await gmailSend(g.secret!, { from: g.config.email, to: a.to, subject: a.subject, text: a.text, threadId: a.threadId });
    return { via: "gmail", id: r.id, thread_id: r.thread_id };
  }
  const p = opSettings?.messaging ?? {};
  if (p.resend_key && p.email_from) {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${p.resend_key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: p.email_from, to: [a.to], reply_to: p.email_from, subject: a.subject, text: a.text }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.message ?? `Resend ${r.status}`);
    return { via: "resend", id: j.id ?? null, thread_id: null };
  }
  return null;
}
