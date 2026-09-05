// DayRunner supplier reconfirmation.
//  POST {operator_id, plan_id, confirmation_ids?}  (member JWT) -> compose + send/mark each supplier confirmation.
//  POST ?token=<connectors.webhook_token, kind 'email'> {from, subject, text} -> inbound reply, matched to latest confirmation for that supplier.
//  Sending prefers the operator's Gmail connector, then Resend, then manual (copy + mark sent). Gmail thread id stored for reply matching.
import { admin, audit, cors, json, requireMember } from "../_shared/auth.ts";
import { sendOperatorEmail } from "../_shared/gmail.ts";
import { bareEmail, matchSupplierReply } from "../_shared/inbound.ts";

const CATEGORY_LABEL: Record<string, string> = {
  activity: "activity booking", meal_breakfast: "breakfast", meal_lunch: "lunch", meal_dinner: "dinner",
  transport: "transport", accommodation: "accommodation", other: "booking",
};
const CATEGORY_LINE: Record<string, string> = {
  activity: "Our guests will arrive at the time above; please let us know if anything about the session or check-in has changed.",
  meal_breakfast: "Please let us know if the numbers above cause any issues with the kitchen.",
  meal_lunch: "Please let us know if the numbers above cause any issues with the kitchen.",
  meal_dinner: "Please let us know if the numbers above cause any issues with the kitchen.",
  transport: "Please confirm the departure time still stands and that the seats are held for us.",
  accommodation: "Please confirm the rooms are held and let us know the check-in arrangements for the group.",
  other: "Please let us know if anything about this booking has changed.",
};

function niceDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-NZ", { weekday: "long", day: "numeric", month: "long" });
}
function compose(op: { name: string }, sup: { name: string; category: string }, c: { detail: string }, date: string) {
  const cat = sup.category ?? "other";
  return [
    `Kia ora ${sup.name} team,`,
    "",
    `Reconfirming for ${niceDate(date)}: ${c.detail}`,
    CATEGORY_LINE[cat] ?? CATEGORY_LINE.other,
    "",
    `Could you reply with a quick "confirmed" so we can close it off our side?`,
    "",
    "Ngā mihi,", op.name,
  ].join("\n");
}
async function polish(key: string, voice: string | null, opName: string, bodies: string[]): Promise<string[]> {
  if (!voice || !bodies.length) return bodies;
  try {
    const prompt = `You are DayRunner, the operations assistant for ${opName}, a tour operator. Rewrite these supplier reconfirmation emails in this voice: ${voice}. Tone: warm but brief, trade-to-trade. You must keep every number, date, time, product name, dietary note and supplier name exactly. Keep the word "confirmed" in the ask. Keep the sign-off name. Return JSON only: {"emails":[{"i":index,"body":"..."}]}.\n\nEmails: ${JSON.stringify(bodies.map((body, i) => ({ i, body })))}`;
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 4000, messages: [{ role: "user", content: prompt }] }) });
    if (!r.ok) return bodies;
    const out = await r.json(); const text = out.content?.[0]?.text ?? "";
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const res = [...bodies];
    for (const e of j.emails ?? []) if (res[e.i] !== undefined && typeof e.body === "string" && e.body.trim()) res[e.i] = e.body;
    return res;
  } catch { return bodies; }
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
      const text = String(body.text ?? body.body ?? body.html ?? "").trim();
      const res = await matchSupplierReply(db, conn.operator_id, { from: body.from ?? body.sender ?? "", subject: body.subject ?? null, text });
      if (res.matched_to === "none") return json({ matched: false, reason: res.reason });
      return json({ matched: true, confirmation_id: res.matched_id, status: res.status });
    }

    // ---------- compose + send ----------
    const { operator_id, plan_id, confirmation_ids } = await req.json();
    if (!operator_id || !plan_id) return json({ error: "operator_id and plan_id required" }, 400);
    const userId = await requireMember(req, operator_id);
    const [{ data: op }, { data: plan }] = await Promise.all([
      db.from("operators").select("name, voice, settings").eq("id", operator_id).single(),
      db.from("plans").select("id, date").eq("id", plan_id).eq("operator_id", operator_id).single(),
    ]);
    if (!op || !plan) return json({ error: "plan not found" }, 404);
    const { data: gmailConn } = await db.from("connectors").select("id").eq("operator_id", operator_id).eq("kind", "gmail").not("secret", "is", null).maybeSingle();
    const provider = op.settings?.messaging ?? {};
    const canEmail = !!gmailConn || !!(provider.resend_key && provider.email_from);
    let q = db.from("supplier_confirmations").select("*").eq("plan_id", plan_id).neq("status", "confirmed");
    if (confirmation_ids?.length) q = q.in("id", confirmation_ids);
    const { data: rows } = await q;
    if (!rows?.length) return json({ results: [] });
    const { data: sups } = await db.from("suppliers").select("id, name, category, email, contact").in("id", rows.map((r) => r.supplier_id));
    const supOf = (id: string) => (sups ?? []).find((s) => s.id === id) ?? { id, name: "supplier", category: "other", email: null, contact: null };

    let bodies = rows.map((c) => compose(op, supOf(c.supplier_id), c, plan.date));
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (key) bodies = await polish(key, op.voice, op.name, bodies);

    const results: any[] = [];
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i]; const sup = supOf(c.supplier_id); const body = bodies[i];
      const to = bareEmail(sup.email ?? "") || bareEmail(sup.contact ?? "");
      let status = "sent_manual"; let note: string | null = null; let via: string | null = null; let threadId: string | null = c.gmail_thread_id ?? null;
      try {
        if (canEmail && to) {
          const subject = `${op.name}: reconfirming ${CATEGORY_LABEL[sup.category] ?? "booking"} for ${niceDate(plan.date)}`;
          const sent = await sendOperatorEmail(db, operator_id, op.settings, { to, subject, text: body, threadId: threadId ?? undefined });
          if (sent) { status = "sent"; via = sent.via; note = sent.id ?? null; if (sent.thread_id) threadId = sent.thread_id; }
          else note = "No email provider configured; copy the draft and send it by hand.";
        } else if (canEmail && !to) note = "No email on file for this supplier; marked as sent by hand.";
        else note = "No email provider configured; copy the draft and send it by hand.";
      } catch (e) { status = "failed"; note = String(e?.message ?? e); }
      const { error: ue } = await db.from("supplier_confirmations").update({ message_body: body, status, sent_at: status === "failed" ? null : new Date().toISOString(), gmail_thread_id: threadId }).eq("id", c.id);
      if (ue) { status = "failed"; note = `db: ${ue.message}`; }
      results.push({ id: c.id, supplier: sup.name, to: to || null, status, via, note });
    }
    await audit(operator_id, userId, "supplier.confirmations.sent", "plan", plan_id, { count: results.length, sent: results.filter((r) => r.status === "sent").length, manual: results.filter((r) => r.status === "sent_manual").length, failed: results.filter((r) => r.status === "failed").length, polished: !!key, gmail: !!gmailConn });
    return json({ results });
  } catch (e) { if (e instanceof Response) return e; return json({ error: String(e?.message ?? e) }, 500); }
});
