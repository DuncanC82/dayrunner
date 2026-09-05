// DayRunner Gmail connector: OAuth.
//  POST {operator_id, return_to}  (member JWT) -> {url, state}: the Google consent URL to redirect the browser to.
//  GET  /callback?code=&state=   (browser redirect from Google, no JWT) -> exchanges the code, stores the refresh token, redirects to return_to.
// State is an HMAC-signed, 10-minute token so the callback can trust operator_id without a session.
// Redirect URI to register in Google Cloud: https://tylttoheoazyvbuixrrk.supabase.co/functions/v1/gmail-auth/callback
import { admin, audit, cors, json, requireMember } from "../_shared/auth.ts";
import { GMAIL_SCOPES, requireEnv } from "../_shared/gmail.ts";

const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | string) => (typeof b === "string" ? btoa(b) : btoa(String.fromCharCode(...new Uint8Array(b)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
async function key() { return crypto.subtle.importKey("raw", enc.encode(Deno.env.get("GMAIL_STATE_SECRET") ?? requireEnv("GOOGLE_CLIENT_SECRET")), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }
async function sign(payload: object) { const p = b64u(JSON.stringify(payload)); const sig = b64u(await crypto.subtle.sign("HMAC", await key(), enc.encode(p))); return `${p}.${sig}`; }
async function verify(state: string): Promise<any> {
  const [p, sig] = state.split("."); if (!p || !sig) throw new Error("bad state");
  const ok = await crypto.subtle.verify("HMAC", await key(), Uint8Array.from(unb64u(sig), (c) => c.charCodeAt(0)), enc.encode(p));
  if (!ok) throw new Error("state signature invalid");
  const j = JSON.parse(unb64u(p)); if (!j.exp || Date.now() > j.exp) throw new Error("state expired; start again");
  return j;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  try {
    // ---------- callback from Google ----------
    if (req.method === "GET" && url.pathname.endsWith("/callback")) {
      const code = url.searchParams.get("code"); const state = url.searchParams.get("state"); const gerr = url.searchParams.get("error");
      let st: any = null;
      try { st = await verify(state ?? ""); } catch (e) { return json({ error: String((e as any)?.message ?? e) }, 400); }
      const back = (q: Record<string, string>) => { const u = new URL(st.return_to); for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v); return Response.redirect(u.toString(), 302); };
      if (gerr || !code) return back({ gmail_error: gerr ?? "no code" });
      const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: requireEnv("GOOGLE_CLIENT_ID"), client_secret: requireEnv("GOOGLE_CLIENT_SECRET"), redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"), grant_type: "authorization_code" }) });
      const tok = await r.json();
      if (!r.ok || !tok.access_token) return back({ gmail_error: tok.error_description ?? tok.error ?? "token exchange failed" });
      const ui = await (await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
      const email = String(ui.email ?? "").toLowerCase(); if (!email) return back({ gmail_error: "could not read the Google account email" });
      const db = admin();
      const { data: existing } = await db.from("connectors").select("id, secret, config").eq("operator_id", st.operator_id).eq("kind", "gmail").maybeSingle();
      // Google only returns refresh_token on first consent (or prompt=consent); keep the old one if a new one did not come back.
      const secret = tok.refresh_token ?? existing?.secret ?? null;
      if (!secret) return back({ gmail_error: "Google did not return a refresh token; remove DayRunner at myaccount.google.com/permissions and connect again" });
      const row = { operator_id: st.operator_id, kind: "gmail", secret, status: "active", last_error: null, config: { ...(existing?.config ?? {}), email, last_poll_at: existing?.config?.last_poll_at ?? new Date().toISOString(), scopes: String(tok.scope ?? "").split(" ") } };
      const { error } = existing ? await db.from("connectors").update(row).eq("id", existing.id) : await db.from("connectors").insert(row);
      if (error) return back({ gmail_error: error.message });
      await audit(st.operator_id, st.user_id ?? "gmail-auth", "connector.gmail.connected", "connector", existing?.id, { email });
      return back({ gmail: "connected", gmail_email: email });
    }

    // ---------- start: signed state + consent URL ----------
    if (req.method !== "POST") return json({ error: "POST {operator_id, return_to} or GET /callback" }, 405);
    const { operator_id, return_to } = await req.json().catch(() => ({}));
    if (!operator_id || !return_to) return json({ error: "operator_id and return_to required" }, 400);
    const userId = await requireMember(req, operator_id);
    const clientId = requireEnv("GOOGLE_CLIENT_ID"); requireEnv("GOOGLE_CLIENT_SECRET"); const redirect = requireEnv("GOOGLE_REDIRECT_URI");
    const state = await sign({ operator_id, return_to, user_id: userId, exp: Date.now() + 10 * 60 * 1000 });
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    for (const [k, v] of Object.entries({ client_id: clientId, redirect_uri: redirect, response_type: "code", scope: GMAIL_SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state })) u.searchParams.set(k, v);
    return json({ url: u.toString(), state, redirect_uri: redirect });
  } catch (e) { if (e instanceof Response) return e; return json({ error: String((e as any)?.message ?? e) }, 500); }
});
