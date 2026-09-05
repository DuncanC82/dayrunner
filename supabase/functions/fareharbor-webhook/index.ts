// FareHarbor connector.
//  POST ?token=<webhook_token>      (FareHarbor booking webhook, full booking JSON) -> upsert departure + booking.
//  POST {operator_id, date}          (member JWT) -> pull availabilities for the date and their bookings via External API v1
//                                     (requires Software Partner app/user keys in connector config).
import { admin, audit, cors, json, requireMember } from "../_shared/auth.ts";

function upsertFromBooking(db: any, operatorId: string, b: any) {
  const av = b.availability ?? {}; const start: string = av.start_at ?? ""; if (!start) return Promise.resolve(0);
  const d = new Date(start); const date = start.slice(0, 10); const time = start.slice(11, 16);
  const productName = av.item?.name ?? av.headline ?? "Unknown product";
  const contact = b.contact ?? {}; const pax = (b.customers ?? []).length || 1;
  const status = b.status === "cancelled" ? "cancelled" : "confirmed";
  const pickup = b.pickup?.name ?? b.lodging?.name ?? null;
  const notes = [b.note, b.pickup?.description, ...(b.customers ?? []).flatMap((c: any) => (c.custom_field_values ?? []).map((f: any) => `${f.name}: ${f.display_value ?? f.value}`))].filter(Boolean).join("; ") || null;
  const src = (b.affiliate_company?.name ?? "direct").toLowerCase();
  return (async () => {
    const { data: prod } = await db.from("products").select("id").eq("operator_id", operatorId).eq("name", productName).maybeSingle();
    const { data: dep } = await db.from("departures").upsert({ operator_id: operatorId, product_id: prod?.id ?? null, product_name: productName, date, time, external_id: String(av.pk ?? "") }, { onConflict: "operator_id,date,time,product_name" }).select().single();
    await db.from("bookings").upsert({ operator_id: operatorId, departure_id: dep.id, external_ref: b.display_id ?? b.uuid, source: src.includes("viator") ? "viator" : src.includes("getyourguide") ? "getyourguide" : src, lead_name: contact.name ?? "Guest", pax, phone: contact.normalized_phone ?? contact.phone ?? null, email: contact.email ?? null, pickup_location: pickup, notes, status, raw: b }, { onConflict: "operator_id,external_ref" });
    void d; return 1;
  })();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  try {
    const url = new URL(req.url); const token = url.searchParams.get("token");
    if (token) {
      const { data: conn } = await db.from("connectors").select("*").eq("kind", "fareharbor").eq("webhook_token", token).maybeSingle();
      if (!conn) return json({ error: "unknown token" }, 404);
      const payload = await req.json(); const b = payload.booking ?? payload;
      const n = await upsertFromBooking(db, conn.operator_id, b);
      await db.from("connectors").update({ last_sync_at: new Date().toISOString(), status: "active", last_error: null }).eq("id", conn.id);
      await audit(conn.operator_id, "fareharbor-webhook", "booking.webhook", "connector", conn.id, { display_id: b.display_id, status: b.status });
      return json({ ok: true, items: n });
    }
    const { operator_id, date } = await req.json();
    const userId = await requireMember(req, operator_id);
    const { data: conn } = await db.from("connectors").select("*").eq("operator_id", operator_id).eq("kind", "fareharbor").maybeSingle();
    const cfg = conn?.config ?? {};
    if (!conn?.secret || !cfg.app_key || !cfg.shortname) return json({ error: "FareHarbor pull needs app key, user key and company shortname (Software Partner access). Webhooks work without them." }, 400);
    const base = cfg.env === "demo" ? "https://demo.fareharbor.com/api/external/v1" : "https://fareharbor.com/api/external/v1";
    const headers = { "X-FareHarbor-API-App": cfg.app_key, "X-FareHarbor-API-User": conn.secret };
    const items = await (await fetch(`${base}/companies/${cfg.shortname}/items/`, { headers })).json();
    let n = 0;
    for (const it of items.items ?? []) {
      const avs = await (await fetch(`${base}/companies/${cfg.shortname}/items/${it.pk}/minimal/availabilities/date/${date}/`, { headers })).json();
      for (const av of avs.availabilities ?? []) {
        const bk = await (await fetch(`${base}/companies/${cfg.shortname}/availabilities/${av.pk}/bookings/`, { headers })).json();
        for (const b of bk.bookings ?? []) n += await upsertFromBooking(db, operator_id, { ...b, availability: { ...av, item: it } });
      }
    }
    await db.from("connectors").update({ last_sync_at: new Date().toISOString(), status: "active", last_error: null }).eq("id", conn.id);
    await audit(operator_id, userId, "fareharbor.sync", "connector", conn.id, { upserted: n, date });
    return json({ ok: true, upserted: n });
  } catch (e) { if (e instanceof Response) return e; return json({ error: String(e?.message ?? e) }, 500); }
});
