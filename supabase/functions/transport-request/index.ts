// DayRunner transport request (charter mode): ask a coach company for a vehicle + driver for a date range.
//  POST {operator_id, request_id}  (member JWT) -> compose in operators.voice, send via Resend or mark manual, status -> requested.
//  POST ?token=<connectors.webhook_token, kind 'email'> {from, subject, text} -> inbound reply; captures driver name/phone/price, flips to confirmed on yes.
//  Sending prefers the operator's Gmail connector, then Resend, then manual. Gmail thread id stored for reply matching.
import { admin, audit, cors, json, requireMember } from "../_shared/auth.ts";
import { sendOperatorEmail } from "../_shared/gmail.ts";
import { bareEmail, extractTransport, matchTransportReply } from "../_shared/inbound.ts";

function niceDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-NZ", { weekday: "long", day: "numeric", month: "long" });
}
function compose(op: { name: string }, sup: { name: string } | null, r: any) {
  const span = r.date_from === r.date_to ? niceDate(r.date_from) : `${niceDate(r.date_from)} to ${niceDate(r.date_to)}`;
  const days = Math.round((Date.parse(r.date_to) - Date.parse(r.date_from)) / 86400000) + 1;
  return [
    `Kia ora ${sup?.name ?? "team"},`,
    "",
    `We would like to request a ${r.vehicle_spec} with driver for ${span} (${days} day${days === 1 ? "" : "s"}), for the whole tour.`,
    r.notes ? String(r.notes) : "",
    "",
    "Could you come back with:",
    "- the price for the tour",
    "- the driver's name and mobile",
    "- whether the driver's meals and accommodation are included in the price, or are for us to cover",
    "",
    `Please reply "confirmed" with those details so we can lock it in.`,
    "",
    "Ngā mihi,", op.name,
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}
async function polish(key: string, voice: string | null, opName: string, body: string): Promise<string> {
  if (!voice) return body;
  try {
    const prompt = `You are DayRunner, the operations assistant for ${opName}, a tour operator. Rewrite this vehicle request email to a coach company in this voice: ${voice}. Tone: warm but brief, trade-to-trade. Keep every date, number, the vehicle specification and the three questions exactly. Keep the word "confirmed" in the ask. Keep the sign-off name. Return JSON only: {"body":"..."}.\n\nEmail: ${JSON.stringify(body)}`;
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", ...(Deno.env.get("ANTHROPIC_WORKSPACE_ID") ? { "anthropic-workspace-id": Deno.env.get("ANTHROPIC_WORKSPACE_ID")! } : {}), "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }) });
    if (!r.ok) return body;
    const out = await r.json(); const text = out.content?.[0]?.text ?? "";
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return typeof j.body === "string" && j.body.trim() ? j.body : body;
  } catch { return body; }
}
/** Kept for callers that imported it; the implementation now lives in _shared/inbound.ts. */
export const extract = extractTransport;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = admin();
    const url = new URL(req.url); const token = url.searchParams.get("token");

    // ---------- inbound reply ----------
    if (token) {
      const { data: conn } = await db.from("connectors").select("operator_id").eq("kind", "email").eq("webhook_token", token).maybeSingle();
      if (!conn) return json({ error: "unknown token" }, 404);
      const body = await req.json().catch(() => ({}));
      const text = String(body.text ?? body.body ?? body.html ?? "").trim();
      const res = await matchTransportReply(db, conn.operator_id, { from: body.from ?? body.sender ?? "", subject: body.subject ?? null, text });
      if (res.matched_to === "none") return json({ matched: false, reason: res.reason });
      return json({ matched: true, request_id: res.matched_id, status: res.status, fields: res.fields });
    }

    // ---------- compose + send ----------
    const { operator_id, request_id } = await req.json();
    if (!operator_id || !request_id) return json({ error: "operator_id and request_id required" }, 400);
    const userId = await requireMember(req, operator_id);
    const [{ data: op }, { data: r }] = await Promise.all([
      db.from("operators").select("name, voice, settings").eq("id", operator_id).single(),
      db.from("transport_requests").select("*").eq("id", request_id).eq("operator_id", operator_id).single(),
    ]);
    if (!op || !r) return json({ error: "request not found" }, 404);
    if (r.status === "confirmed") return json({ id: r.id, status: r.status, note: "Already confirmed; nothing sent." });
    const sup = r.supplier_id ? (await db.from("suppliers").select("id, name, email, contact").eq("id", r.supplier_id).maybeSingle()).data : null;
    const { data: gmailConn } = await db.from("connectors").select("id").eq("operator_id", operator_id).eq("kind", "gmail").not("secret", "is", null).maybeSingle();
    const provider = op.settings?.messaging ?? {};
    const canEmail = !!gmailConn || !!(provider.resend_key && provider.email_from);
    let body = compose(op, sup, r);
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (key) body = await polish(key, op.voice, op.name, body);
    const to = bareEmail(sup?.email ?? "") || bareEmail(sup?.contact ?? "");
    let status = "requested"; let note: string | null = null; let sent = "manual"; let threadId: string | null = r.gmail_thread_id ?? null;
    try {
      if (canEmail && to) {
        const subject = `${op.name}: vehicle request ${r.vehicle_spec}, ${niceDate(r.date_from)}${r.date_from === r.date_to ? "" : ` to ${niceDate(r.date_to)}`}`;
        const out = await sendOperatorEmail(db, operator_id, op.settings, { to, subject, text: body, threadId: threadId ?? undefined });
        if (out) { sent = out.via; note = out.id ?? null; if (out.thread_id) threadId = out.thread_id; }
        else note = "No email provider configured; copy the draft and send it by hand.";
      } else if (!sup) note = "No coach company chosen; copy the draft and send it by hand.";
      else if (canEmail && !to) note = "No email on file for this coach company; copy the draft and send it by hand.";
      else note = "No email provider configured; copy the draft and send it by hand.";
    } catch (e) { status = "pending"; note = String((e as any)?.message ?? e); }
    const { error: ue } = await db.from("transport_requests").update({ message_body: body, status, sent_at: status === "requested" ? new Date().toISOString() : null, gmail_thread_id: threadId }).eq("id", r.id);
    if (ue) return json({ error: ue.message }, 500);
    await audit(operator_id, userId, "transport.request.sent", "transport_request", r.id, { to: to || null, sent, status, polished: !!key });
    return json({ id: r.id, status, sent, to: to || null, note, message_body: body });
  } catch (e) { if (e instanceof Response) return e; return json({ error: String((e as any)?.message ?? e) }, 500); }
});
