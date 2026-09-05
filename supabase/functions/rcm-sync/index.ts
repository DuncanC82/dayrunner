// Rental Car Manager connector (generic, config-driven). Independently developed DayRunner Provider IP.
// RCM exposes its Booking API v3.x at https://apis.rentalcarmanager.com/booking/v3.x with an apikey header, and
// event "Automations" webhooks that can POST to a URL. Field names differ per account, so the mapping lives in
// connector.config.map and is locked against the operator's sandbox.
//  POST ?token=<webhook_token>  (RCM automation webhook) -> upsert one reservation as a pickup/return "departure".
//  POST {operator_id, date}      (member JWT)           -> pull reservations for the date via the configured export endpoint.
import { admin, audit, cors, json, requireMember } from "../_shared/auth.ts";

const get = (o: any, path: string) => path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);

async function upsertReservation(db: any, operatorId: string, cfg: any, row: any) {
  const m = cfg.map ?? {};
  const pickupAt: string = String(get(row, m.pickup_at ?? "pickupdate") ?? ""); if (!pickupAt) return 0;
  const date = pickupAt.slice(0, 10); const time = (String(get(row, m.pickup_time ?? "pickuptime") ?? pickupAt.slice(11, 16)) || "09:00").slice(0, 5);
  const vehicleClass = String(get(row, m.category ?? "categoryname") ?? "Vehicle handover");
  const productName = `${cfg.label ?? "Handover"}: ${vehicleClass}`;
  const { data: prod } = await db.from("products").select("id").eq("operator_id", operatorId).eq("name", productName).maybeSingle();
  const { data: dep } = await db.from("departures").upsert({ operator_id: operatorId, product_id: prod?.id ?? null, product_name: productName, date, time, external_id: String(get(row, m.location ?? "pickuplocation") ?? "") }, { onConflict: "operator_id,date,time,product_name" }).select().single();
  const cancelled = /cancel/i.test(String(get(row, m.status ?? "status") ?? ""));
  await db.from("bookings").upsert({ operator_id: operatorId, departure_id: dep.id, external_ref: String(get(row, m.ref ?? "reservationno") ?? crypto.randomUUID()), source: String(get(row, m.source ?? "source") ?? "direct").toLowerCase(), lead_name: [get(row, m.first_name ?? "firstname"), get(row, m.last_name ?? "lastname")].filter(Boolean).join(" ") || "Guest", pax: Number(get(row, m.pax ?? "adults") ?? 1) || 1, phone: get(row, m.phone ?? "mobile") ?? null, email: get(row, m.email ?? "email") ?? null, pickup_location: get(row, m.location ?? "pickuplocation") ?? null, notes: [get(row, m.notes ?? "notes"), get(row, m.flight ?? "flightno") ? `Flight ${get(row, m.flight ?? "flightno")}` : null].filter(Boolean).join("; ") || null, status: cancelled ? "cancelled" : "confirmed", raw: row }, { onConflict: "operator_id,external_ref" });
  return 1;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  try {
    const url = new URL(req.url); const token = url.searchParams.get("token");
    if (token) {
      const { data: conn } = await db.from("connectors").select("*").eq("kind", "rcm").eq("webhook_token", token).maybeSingle();
      if (!conn) return json({ error: "unknown token" }, 404);
      const row = await req.json();
      const n = await upsertReservation(db, conn.operator_id, conn.config ?? {}, row.reservation ?? row);
      await db.from("connectors").update({ last_sync_at: new Date().toISOString(), status: "active", last_error: null }).eq("id", conn.id);
      await audit(conn.operator_id, "rcm-webhook", "booking.webhook", "connector", conn.id, { items: n });
      return json({ ok: true, items: n });
    }
    const { operator_id, date } = await req.json();
    const userId = await requireMember(req, operator_id);
    const { data: conn } = await db.from("connectors").select("*").eq("operator_id", operator_id).eq("kind", "rcm").maybeSingle();
    const cfg = conn?.config ?? {};
    if (!conn?.secret || !cfg.api_base || !cfg.reservations_path) return json({ error: "RCM pull needs API base, reservations path and API key from your RCM sandbox. Automation webhooks work without them." }, 400);
    const u = new URL(cfg.reservations_path, cfg.api_base);
    if (cfg.account_id) u.searchParams.set("accountId", cfg.account_id);
    u.searchParams.set(cfg.date_from_param ?? "dateFrom", date); u.searchParams.set(cfg.date_to_param ?? "dateTo", date);
    const headers: Record<string, string> = { accept: "application/json" };
    if ((cfg.auth ?? "header") === "header") headers.apikey = conn.secret; else u.searchParams.set("apikey", conn.secret);
    const r = await fetch(u.toString(), { headers });
    if (!r.ok) { const t = await r.text(); await db.from("connectors").update({ last_error: `RCM ${r.status}: ${t.slice(0, 200)}`, status: "error" }).eq("id", conn.id); return json({ error: `RCM ${r.status}: ${t.slice(0, 200)}` }, 502); }
    const body = await r.json(); const rows = Array.isArray(body) ? body : body?.data ?? body?.results ?? body?.reservations ?? [];
    let n = 0; for (const row of rows) n += await upsertReservation(db, operator_id, cfg, row);
    await db.from("connectors").update({ last_sync_at: new Date().toISOString(), status: "active", last_error: null }).eq("id", conn.id);
    await audit(operator_id, userId, "rcm.sync", "connector", conn.id, { upserted: n, date });
    return json({ ok: true, upserted: n });
  } catch (e) { if (e instanceof Response) return e; return json({ error: String(e?.message ?? e) }, 500); }
});
