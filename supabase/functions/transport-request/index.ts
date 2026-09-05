// DayRunner transport request (charter mode): ask a coach company for a vehicle + driver for a date range.
//  POST {operator_id, request_id}  (member JWT) -> compose in operators.voice, send via Resend or mark manual, status -> requested.
//  POST ?token=<connectors.webhook_token, kind 'email'> {from, subject, text} -> inbound reply; captures driver name/phone/price, flips to confirmed on yes.
import { admin, audit, cors, json, requireMember } from "../_shared/auth.ts";

const YES = /\b(confirm(ed|ing)?|yes|yep|all good|sweet as|no problem|no worries|booked|sorted|locked in)\b/i;
const NO = /\b(unable|can't|cannot|no availability|fully booked|decline[d]?|sorry we)\b/i;

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
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }) });
    if (!r.ok) return body;
    const out = await r.json(); const text = out.content?.[0]?.text ?? "";
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return typeof j.body === "string" && j.body.trim() ? j.body : body;
  } catch { return body; }
}
const bareEmail = (s: string) => (String(s ?? "").match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? "").toLowerCase();

/** Pull driver name, phone, price and inclusions out of a free-text reply. Best effort; the coordinator can correct by hand. */
export function extract(text: string) {
  const out: Record<string, unknown> = {};
  const name = text.match(/[Dd]river(?:'s| is| will be|:)?\s*(?:name\s*(?:is|:)?\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/) ?? text.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:will be|is) (?:your |the )?driver/i);
  if (name) out.driver_name = name[1];
  const phone = text.match(/(?:\+64|0)[\s-]?2\d[\s-]?\d{3}[\s-]?\d{3,4}/);
  if (phone) out.driver_phone = phone[0].replace(/\s+/g, " ").trim();
  const price = text.match(/(?:NZ?\$|\$|NZD\s?)\s?([\d,]+(?:\.\d{1,2})?)/i) ?? text.match(/([\d,]+(?:\.\d{1,2})?)\s?(?:NZD|dollars)/i);
  if (price) { const n = Number(price[1].replace(/,/g, "")); if (!Number.isNaN(n)) out.price = n; }
  const meals = text.match(/meals?\b[^.,;\n]{0,40}\b(included|inclusive|covered|on us)/i) ?? text.match(/\b(includes?|including|incl\.?)\b[^.,;\n]{0,40}\bmeals?/i);
  const mealsNot = /meals?\b[^.,;\n]{0,40}\b(not included|excluded|extra|for you to cover|your cost)/i.test(text);
  if (meals || mealsNot) out.driver_meals_included = !!meals && !mealsNot;
  const acc = text.match(/accom+odation\b[^.,;\n]{0,40}\b(included|inclusive|covered|on us)/i) ?? text.match(/\b(includes?|including|incl\.?)\b[^.,;\n]{0,40}\baccom+odation/i);
  const accNot = /accom+odation\b[^.,;\n]{0,40}\b(not included|excluded|extra|for you to cover|your cost)/i.test(text);
  if (acc || accNot) out.driver_accommodation_included = !!acc && !accNot;
  return out;
}

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
      const from = bareEmail(body.from ?? body.sender ?? ""); const text = String(body.text ?? body.body ?? body.html ?? "").trim();
      if (!from) return json({ matched: false, reason: "no sender" });
      const { data: sups } = await db.from("suppliers").select("id, name, email, contact").eq("operator_id", conn.operator_id);
      const sup = (sups ?? []).find((s) => bareEmail(s.email ?? "") === from) ?? (sups ?? []).find((s) => bareEmail(s.contact ?? "") === from);
      if (!sup) return json({ matched: false, reason: "unknown sender" });
      const { data: r } = await db.from("transport_requests").select("id, status").eq("operator_id", conn.operator_id).eq("supplier_id", sup.id)
        .in("status", ["requested", "pending"]).order("sent_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      if (!r) return json({ matched: false, reason: "no open request" });
      const fields = extract(text);
      const status = YES.test(text) && !NO.test(text) ? "confirmed" : NO.test(text) ? "declined" : r.status;
      const { error: ue } = await db.from("transport_requests").update({ ...fields, reply_text: text.slice(0, 4000), replied_at: new Date().toISOString(), status }).eq("id", r.id);
      if (ue) return json({ matched: true, request_id: r.id, error: ue.message }, 500);
      await audit(conn.operator_id, "inbound-email", "transport.reply.received", "transport_request", r.id, { from, status, fields });
      return json({ matched: true, request_id: r.id, status, fields });
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
    const provider = op.settings?.messaging ?? {};
    const canEmail = !!(provider.resend_key && provider.email_from);
    let body = compose(op, sup, r);
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (key) body = await polish(key, op.voice, op.name, body);
    const to = bareEmail(sup?.email ?? "") || bareEmail(sup?.contact ?? "");
    let status = "requested"; let note: string | null = null; let sent = "manual";
    try {
      if (canEmail && to) {
        const subject = `${op.name}: vehicle request ${r.vehicle_spec}, ${niceDate(r.date_from)}${r.date_from === r.date_to ? "" : ` to ${niceDate(r.date_to)}`}`;
        const resp = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${provider.resend_key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: provider.email_from, to: [to], reply_to: provider.email_from, subject, text: body }) });
        const j = await resp.json(); if (!resp.ok) throw new Error(j.message ?? `Resend ${resp.status}`);
        sent = "email"; note = j.id ?? null;
      } else if (!sup) note = "No coach company chosen; copy the draft and send it by hand.";
      else if (canEmail && !to) note = "No email on file for this coach company; copy the draft and send it by hand.";
      else note = "No email provider configured; copy the draft and send it by hand.";
    } catch (e) { status = "pending"; note = String((e as any)?.message ?? e); }
    const { error: ue } = await db.from("transport_requests").update({ message_body: body, status, sent_at: status === "requested" ? new Date().toISOString() : null }).eq("id", r.id);
    if (ue) return json({ error: ue.message }, 500);
    await audit(operator_id, userId, "transport.request.sent", "transport_request", r.id, { to: to || null, sent, status, polished: !!key });
    return json({ id: r.id, status, sent, to: to || null, note, message_body: body });
  } catch (e) { if (e instanceof Response) return e; return json({ error: String((e as any)?.message ?? e) }, 500); }
});
