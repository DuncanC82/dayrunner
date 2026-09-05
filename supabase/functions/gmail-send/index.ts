// DayRunner Gmail connector: send one email from the operator's connected Google address.
//  POST {operator_id, to, subject, text, in_reply_to?, thread_id?}  (member JWT) -> {id, thread_id, from}
import { admin, audit, cors, json, requireMember } from "../_shared/auth.ts";
import { getGmailConnector, gmailSend } from "../_shared/gmail.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { operator_id, to, subject, text, in_reply_to, thread_id } = await req.json().catch(() => ({}));
    if (!operator_id || !to || !subject || !text) return json({ error: "operator_id, to, subject and text required" }, 400);
    const userId = await requireMember(req, operator_id);
    const db = admin();
    const g = await getGmailConnector(db, operator_id);
    if (!g?.config?.email) return json({ error: "no Gmail connector for this operator; connect Google in Connectors first" }, 404);
    try {
      const r = await gmailSend(g.secret!, { from: g.config.email, to, subject, text, inReplyTo: in_reply_to, threadId: thread_id });
      await audit(operator_id, userId, "gmail.sent", "connector", g.id, { to, subject, message_id: r.id, thread_id: r.thread_id });
      return json({ ...r, from: g.config.email });
    } catch (e) {
      await db.from("connectors").update({ last_error: String((e as any)?.message ?? e) }).eq("id", g.id);
      throw e;
    }
  } catch (e) { if (e instanceof Response) return e; return json({ error: String((e as any)?.message ?? e) }, 500); }
});
