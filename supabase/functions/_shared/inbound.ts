// Shared inbound-reply matcher. Used by the legacy email webhooks (supplier-confirm?token, transport-request?token) and by gmail-poll.
// Matching order: Gmail thread id (exact) -> sender email against suppliers (fallback) -> none.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { audit } from "./auth.ts";

export const YES = /\b(confirm(ed|ing)?|yes|yep|all good|sweet as|no problem|no worries|booked|sorted|locked in)\b/i;
export const NO = /\b(unable|can't|cannot|no availability|fully booked|decline[d]?|sorry we)\b/i;
export const bareEmail = (s: string) => (String(s ?? "").match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? "").toLowerCase();

export type Inbound = { from: string; subject?: string | null; text: string; thread_id?: string | null; actor?: string };
export type MatchResult = { matched_to: "supplier_confirmation" | "transport_request" | "booking" | "none"; matched_id: string | null; status?: string; reason?: string; fields?: Record<string, unknown> };

/** Pull driver name, phone, price and inclusions out of a free-text coach-company reply. Best effort; the coordinator can correct by hand. */
export function extractTransport(text: string) {
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

async function applySupplierReply(db: SupabaseClient, operatorId: string, confirmationId: string, m: Inbound): Promise<MatchResult> {
  const status = YES.test(m.text) ? "confirmed" : "replied";
  const { error } = await db.from("supplier_confirmations").update({ reply_text: m.text.slice(0, 4000), replied_at: new Date().toISOString(), status }).eq("id", confirmationId);
  if (error) throw new Error(error.message);
  await audit(operatorId, m.actor ?? "inbound-email", "supplier.reply.received", "supplier_confirmation", confirmationId, { from: m.from, subject: m.subject ?? null, status, thread_id: m.thread_id ?? null });
  return { matched_to: "supplier_confirmation", matched_id: confirmationId, status };
}

async function applyTransportReply(db: SupabaseClient, operatorId: string, r: { id: string; status: string }, m: Inbound): Promise<MatchResult> {
  const fields = extractTransport(m.text);
  const status = YES.test(m.text) && !NO.test(m.text) ? "confirmed" : NO.test(m.text) ? "declined" : r.status;
  const { error } = await db.from("transport_requests").update({ ...fields, reply_text: m.text.slice(0, 4000), replied_at: new Date().toISOString(), status }).eq("id", r.id);
  if (error) throw new Error(error.message);
  await audit(operatorId, m.actor ?? "inbound-email", "transport.reply.received", "transport_request", r.id, { from: m.from, status, fields, thread_id: m.thread_id ?? null });
  return { matched_to: "transport_request", matched_id: r.id, status, fields };
}

async function supplierFor(db: SupabaseClient, operatorId: string, from: string) {
  const { data: sups } = await db.from("suppliers").select("id, name, email, contact").eq("operator_id", operatorId);
  return (sups ?? []).find((s) => bareEmail(s.email ?? "") === from) ?? (sups ?? []).find((s) => bareEmail(s.contact ?? "") === from) ?? null;
}

/** Supplier-confirmation webhook behaviour (sender match only). Kept for the legacy ?token relay. */
export async function matchSupplierReply(db: SupabaseClient, operatorId: string, m: Inbound): Promise<MatchResult> {
  const from = bareEmail(m.from); if (!from) return { matched_to: "none", matched_id: null, reason: "no sender" };
  const sup = await supplierFor(db, operatorId, from); if (!sup) return { matched_to: "none", matched_id: null, reason: "unknown sender" };
  let { data: c } = await db.from("supplier_confirmations").select("id").eq("operator_id", operatorId).eq("supplier_id", sup.id)
    .in("status", ["sent", "sent_manual", "replied"]).not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(1).maybeSingle();
  if (!c) {
    const { data: pend } = await db.from("supplier_confirmations").select("id, plans!inner(date)").eq("operator_id", operatorId).eq("supplier_id", sup.id)
      .in("status", ["pending", "hold"]).order("date", { referencedTable: "plans", ascending: true }).limit(1).maybeSingle();
    c = pend as any;
  }
  if (!c) return { matched_to: "none", matched_id: null, reason: "no open confirmation" };
  return applySupplierReply(db, operatorId, c.id, { ...m, from });
}

/** Transport-request webhook behaviour (sender match only). Kept for the legacy ?token relay. */
export async function matchTransportReply(db: SupabaseClient, operatorId: string, m: Inbound): Promise<MatchResult> {
  const from = bareEmail(m.from); if (!from) return { matched_to: "none", matched_id: null, reason: "no sender" };
  const sup = await supplierFor(db, operatorId, from); if (!sup) return { matched_to: "none", matched_id: null, reason: "unknown sender" };
  const { data: r } = await db.from("transport_requests").select("id, status").eq("operator_id", operatorId).eq("supplier_id", sup.id)
    .in("status", ["requested", "pending"]).order("sent_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (!r) return { matched_to: "none", matched_id: null, reason: "no open request" };
  return applyTransportReply(db, operatorId, r, { ...m, from });
}

/** Full matcher for Gmail-polled messages: thread id first, then sender fallback (transport request before supplier confirmation). */
export async function matchInbound(db: SupabaseClient, operatorId: string, m: Inbound): Promise<MatchResult> {
  if (m.thread_id) {
    const { data: c } = await db.from("supplier_confirmations").select("id").eq("operator_id", operatorId).eq("gmail_thread_id", m.thread_id).maybeSingle();
    if (c) return applySupplierReply(db, operatorId, c.id, m);
    const { data: r } = await db.from("transport_requests").select("id, status").eq("operator_id", operatorId).eq("gmail_thread_id", m.thread_id).maybeSingle();
    if (r) return applyTransportReply(db, operatorId, r, m);
  }
  const t = await matchTransportReply(db, operatorId, m);
  if (t.matched_to !== "none") return t;
  const s = await matchSupplierReply(db, operatorId, m);
  if (s.matched_to !== "none") return s;
  return { matched_to: "none", matched_id: null, reason: s.reason ?? t.reason };
}
