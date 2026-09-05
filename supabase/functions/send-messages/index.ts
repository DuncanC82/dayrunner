// Sends approved messages for a plan through the operator's configured provider.
// Providers: twilio (WhatsApp + SMS), resend (email), manual (marks sent, operator copies text). Never sends drafts or held messages.
import { admin, audit, cors, json, requireMember } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { operator_id, plan_id, message_ids, mode } = await req.json();
    if (!operator_id || !plan_id) return json({ error: "operator_id and plan_id required" }, 400);
    const userId = await requireMember(req, operator_id);
    const db = admin();
    const { data: op } = await db.from("operators").select("name, settings").eq("id", operator_id).single();
    const provider = op?.settings?.messaging ?? {};
    let q = db.from("messages").select("*").eq("plan_id", plan_id).eq("status", "approved");
    if (message_ids?.length) q = q.in("id", message_ids);
    const { data: msgs } = await q;
    const results: any[] = [];
    for (const m of msgs ?? []) {
      let status = "sent"; let ref: string | null = null; let error: string | null = null;
      try {
        if (mode === "manual" || m.channel === "manual") { ref = "manual"; }
        else if ((m.channel === "whatsapp" || m.channel === "sms") && provider.twilio_sid && provider.twilio_token && provider.twilio_from) {
          const isWa = m.channel === "whatsapp" && provider.whatsapp_from;
          const from = isWa ? `whatsapp:${provider.whatsapp_from}` : provider.twilio_from;
          const to = isWa ? `whatsapp:${m.recipient}` : m.recipient;
          const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${provider.twilio_sid}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${provider.twilio_sid}:${provider.twilio_token}`), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ From: from, To: to, Body: m.body }) });
          const j = await r.json(); if (!r.ok) throw new Error(j.message ?? `Twilio ${r.status}`); ref = j.sid;
        } else if (m.channel === "email" && provider.resend_key && provider.email_from) {
          const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${provider.resend_key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: provider.email_from, to: [m.recipient], subject: `${op?.name}: your pickup tomorrow`, text: m.body }) });
          const j = await r.json(); if (!r.ok) throw new Error(j.message ?? `Resend ${r.status}`); ref = j.id;
        } else { status = "sent"; ref = "manual"; error = "No provider configured for this channel; marked sent manually."; }
      } catch (e) { status = "failed"; error = String(e?.message ?? e); }
      await db.from("messages").update({ status, sent_at: status === "sent" ? new Date().toISOString() : null, provider_ref: ref, error }).eq("id", m.id);
      results.push({ id: m.id, status, error });
    }
    const allDone = (await db.from("messages").select("id", { count: "exact", head: true }).eq("plan_id", plan_id).in("status", ["approved", "draft"])).count === 0;
    if (allDone) await db.from("plans").update({ status: "sent" }).eq("id", plan_id);
    await audit(operator_id, userId, "messages.sent", "plan", plan_id, { count: results.length, failed: results.filter((r) => r.status === "failed").length });
    return json({ results });
  } catch (e) { if (e instanceof Response) return e; return json({ error: String(e?.message ?? e) }, 500); }
});
