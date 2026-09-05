// DayRunner Gmail connector: read new inbox messages and match them to open supplier confirmations / transport requests.
//  POST {operator_id}  (member JWT)                         -> poll one operator's inbox.
//  POST {} with header x-poll-secret: <GMAIL_POLL_SECRET>   -> poll every gmail connector (for a scheduled job / pg_cron / cron-job.org).
// Idempotent: inbound_emails.gmail_message_id is unique, so re-polling never double-applies a reply.
import { admin, cors, json, requireMember } from "../_shared/auth.ts";
import { accessToken, gmailGet, gmailList, type GmailConnector } from "../_shared/gmail.ts";
import { matchInbound } from "../_shared/inbound.ts";

async function pollConnector(db: ReturnType<typeof admin>, g: GmailConnector, actor: string) {
  const out = { operator_id: g.operator_id, email: g.config.email, fetched: 0, new: 0, matched: 0, none: 0, errors: [] as string[] };
  try {
    const token = await accessToken(g.secret!);
    // Look back from last_poll_at with a 1-hour overlap (Gmail's after: is day-granular when given a date; epoch seconds work).
    const since = Math.floor((Date.parse(g.config.last_poll_at ?? "") || Date.now() - 7 * 86400000) / 1000) - 3600;
    const q = `in:inbox -from:me after:${since}`;
    const ids = await gmailList(token, q, 50); out.fetched = ids.length;
    if (ids.length) {
      const { data: seen } = await db.from("inbound_emails").select("gmail_message_id").in("gmail_message_id", ids);
      const seenSet = new Set((seen ?? []).map((s) => s.gmail_message_id));
      for (const id of ids.filter((i) => !seenSet.has(i))) {
        try {
          const m = await gmailGet(token, id);
          const { data: row, error } = await db.from("inbound_emails").insert({ operator_id: g.operator_id, connector_id: g.id, gmail_message_id: m.id, thread_id: m.thread_id, from_email: m.from_email, subject: m.subject, snippet: m.snippet, body_text: m.body_text, received_at: m.received_at }).select("id").single();
          if (error) { if (!/duplicate/i.test(error.message)) out.errors.push(error.message); continue; }
          out.new++;
          const res = await matchInbound(db, g.operator_id, { from: m.from_email, subject: m.subject, text: m.body_text || m.snippet, thread_id: m.thread_id, actor });
          await db.from("inbound_emails").update({ matched_to: res.matched_to, matched_id: res.matched_id, processed_at: new Date().toISOString() }).eq("id", row.id);
          if (res.matched_to === "none") out.none++; else out.matched++;
        } catch (e) { out.errors.push(`${id}: ${String((e as any)?.message ?? e)}`); }
      }
    }
    await db.from("connectors").update({ status: "active", last_sync_at: new Date().toISOString(), last_error: out.errors[0] ?? null, config: { ...g.config, last_poll_at: new Date().toISOString() } }).eq("id", g.id);
  } catch (e) {
    const msg = String((e as any)?.message ?? e); out.errors.push(msg);
    await db.from("connectors").update({ status: "error", last_error: msg }).eq("id", g.id);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = admin();
    const body = await req.json().catch(() => ({}));
    const pollSecret = Deno.env.get("GMAIL_POLL_SECRET"); const hdr = req.headers.get("x-poll-secret");
    if (hdr && pollSecret && hdr === pollSecret) {
      const { data: conns } = await db.from("connectors").select("id, operator_id, secret, config").eq("kind", "gmail").not("secret", "is", null);
      const results = []; for (const g of conns ?? []) results.push(await pollConnector(db, g as GmailConnector, "gmail-poll"));
      return json({ mode: "all", results });
    }
    if (hdr && !pollSecret) return json({ error: "missing GMAIL_POLL_SECRET" }, 500);
    const { operator_id } = body; if (!operator_id) return json({ error: "operator_id required" }, 400);
    const userId = await requireMember(req, operator_id);
    const { data: g } = await db.from("connectors").select("id, operator_id, secret, config").eq("operator_id", operator_id).eq("kind", "gmail").maybeSingle();
    if (!g?.secret) return json({ error: "no Gmail connector for this operator; connect Google in Connectors first" }, 404);
    return json(await pollConnector(db, g as GmailConnector, userId));
  } catch (e) { if (e instanceof Response) return e; return json({ error: String((e as any)?.message ?? e) }, 500); }
});
