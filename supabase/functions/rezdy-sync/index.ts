// Rezdy connector. Two modes:
//  POST {operator_id, date}            (member JWT)      -> pull sessions + bookings for that date via Supplier API and upsert.
//  POST ?token=<webhook_token>          (Rezdy webhook)   -> NEW_ORDER / UPDATED_ORDER / CANCELLED_ORDER payload upsert.
// Supplier API: https://api.rezdy.com/v1 with apiKey header. Staging: https://api.rezdy-staging.com/v1
import { admin, audit, cors, json, requireMember } from "../_shared/auth.ts";

const BASES: Record<string, string> = { production: "https://api.rezdy.com/v1", staging: "https://api.rezdy-staging.com/v1" };

async function upsertOrder(db: any, operatorId: string, order: any) {
  const items = order.items ?? [];
  let n = 0;
  for (const it of items) {
    const start: string = it.startTimeLocal ?? it.startTime ?? ""; if (!start) continue;
    const [date, timeFull] = start.replace("T", " ").split(" "); const time = (timeFull ?? "00:00").slice(0, 5);
    const productName = it.productName ?? it.productCode ?? "Unknown product";
    const { data: prod } = await db.from("products").select("id").eq("operator_id", operatorId).eq("name", productName).maybeSingle();
    const { data: dep } = await db.from("departures").upsert({ operator_id: operatorId, product_id: prod?.id ?? null, product_name: productName, date, time, external_id: String(it.sessionId ?? "") }, { onConflict: "operator_id,date,time,product_name" }).select().single();
    const pax = (it.quantities ?? []).reduce((a: number, q: any) => a + Number(q.value ?? 0), 0) || Number(it.totalQuantity ?? 1);
    const c = order.customer ?? {};
    const cancelled = String(order.status ?? "").toUpperCase() === "CANCELLED";
    const src = (order.resellerName ?? order.source ?? "direct").toString().toLowerCase();
    await db.from("bookings").upsert({
      operator_id: operatorId, departure_id: dep.id, external_ref: `${order.orderNumber}${items.length > 1 ? "-" + it.productCode : ""}`,
      source: src.includes("viator") ? "viator" : src.includes("getyourguide") || src.includes("gyg") ? "getyourguide" : src.includes("api") || src.includes("online") ? "direct" : src,
      lead_name: [c.firstName, c.lastName].filter(Boolean).join(" ") || "Guest", pax, phone: c.phone ?? c.mobile ?? null, email: c.email ?? null,
      pickup_location: it.pickupLocation?.locationName ?? null,
      notes: [order.comments, it.pickupLocation?.pickupInstructions, ...(it.extras ?? []).map((e: any) => e.name)].filter(Boolean).join("; ") || null,
      status: cancelled ? "cancelled" : "confirmed", raw: order,
    }, { onConflict: "operator_id,external_ref" });
    n++;
  }
  return n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  try {
    const url = new URL(req.url); const token = url.searchParams.get("token");
    if (token) {
      const { data: conn } = await db.from("connectors").select("*").eq("kind", "rezdy").eq("webhook_token", token).maybeSingle();
      if (!conn) return json({ error: "unknown token" }, 404);
      const payload = await req.json();
      const order = payload.order ?? payload;
      const n = await upsertOrder(db, conn.operator_id, order);
      await db.from("connectors").update({ last_sync_at: new Date().toISOString(), status: "active", last_error: null }).eq("id", conn.id);
      await audit(conn.operator_id, "rezdy-webhook", "booking.webhook", "connector", conn.id, { orderNumber: order.orderNumber, items: n });
      return json({ ok: true, items: n });
    }
    const { operator_id, date } = await req.json();
    const userId = await requireMember(req, operator_id);
    const { data: conn } = await db.from("connectors").select("*").eq("operator_id", operator_id).eq("kind", "rezdy").maybeSingle();
    if (!conn?.secret) return json({ error: "Add your Rezdy API key in Settings → Connectors first." }, 400);
    const base = BASES[conn.config?.env ?? "production"] ?? BASES.production;
    const headers = { apiKey: conn.secret, accept: "application/json" };
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 45).toISOString().slice(0, 19).replace("T", " ");
    let offset = 0, total = 0, matched = 0;
    for (let page = 0; page < 20; page++) {
      const r = await fetch(`${base}/bookings?updatedSince=${encodeURIComponent(since)}&limit=100&offset=${offset}`, { headers });
      if (!r.ok) { const t = await r.text(); await db.from("connectors").update({ last_error: `Rezdy ${r.status}: ${t.slice(0, 200)}`, status: "error" }).eq("id", conn.id); return json({ error: `Rezdy ${r.status}: ${t.slice(0, 200)}` }, 502); }
      const body = await r.json(); const orders = body.bookings ?? [];
      for (const o of orders) { total++; const hit = (o.items ?? []).some((it: any) => String(it.startTimeLocal ?? it.startTime ?? "").startsWith(date)); if (hit || !date) { matched += await upsertOrder(db, operator_id, o); } }
      if (orders.length < 100) break; offset += 100;
    }
    await db.from("connectors").update({ last_sync_at: new Date().toISOString(), status: "active", last_error: null }).eq("id", conn.id);
    await audit(operator_id, userId, "rezdy.sync", "connector", conn.id, { scanned: total, upserted: matched, date });
    return json({ ok: true, scanned: total, upserted: matched });
  } catch (e) { if (e instanceof Response) return e; return json({ error: String(e?.message ?? e) }, 500); }
});
