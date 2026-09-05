// DayRunner driver briefing: one evening-before message per driver-guide plus a group digest for the staff WhatsApp group.
// Deterministic template. Rows go into `messages` as drafts; the existing send-messages function sends them once approved.
import { admin, audit, cors, json, requireMember } from "../_shared/auth.ts";

const MAX = 700;
const norm = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const surname = (n: string) => { const p = (n ?? "").trim().split(/\s+/); return p[p.length - 1] || n; };
const first = (n: string) => (n ?? "").trim().split(/\s+/)[0] || n;
const dayLabel = (iso: string) => { const d = new Date(iso + "T12:00:00"); return d.toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" }); };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { operator_id, plan_id } = await req.json();
    if (!operator_id || !plan_id) return json({ error: "operator_id and plan_id required" }, 400);
    const userId = await requireMember(req, operator_id);
    const db = admin();

    const { data: plan, error: pe } = await db.from("plans").select("*").eq("id", plan_id).eq("operator_id", operator_id).single();
    if (pe || !plan) return json({ error: "plan not found" }, 404);
    const [op, allocs, deps, staff, sups, excs, supDefs] = await Promise.all([
      db.from("operators").select("*").eq("id", operator_id).single(),
      db.from("allocations").select("*").eq("plan_id", plan_id),
      db.from("departures").select("*").eq("operator_id", operator_id).eq("date", plan.date),
      db.from("staff").select("*").eq("operator_id", operator_id),
      db.from("supplier_confirmations").select("*").eq("plan_id", plan_id),
      db.from("exceptions").select("*").eq("plan_id", plan_id).eq("resolved", false),
      db.from("suppliers").select("name, product_names").eq("operator_id", operator_id),
    ]);
    const operator = op.data; const A: any[] = allocs.data ?? []; const D: any[] = deps.data ?? []; const S: any[] = staff.data ?? []; const SUP: any[] = sups.data ?? [];
    const depOf = (id: string) => D.find((d) => d.id === id);
    const link = `${operator?.settings?.app_url ?? ""}/#/app/guide`;
    const date = dayLabel(plan.date);
    const alert = plan.alerts ? String(plan.alerts).split(".")[0].trim() : "";

    // Departures in time order, with their allocation
    const runs = A.map((a) => ({ a, d: depOf(a.departure_id) })).filter((r) => r.d).sort((x, y) => String(x.d.time).localeCompare(String(y.d.time)));
    // Supplier stops for a departure: suppliers whose product list matches the product name (same heuristic as plan-day), with this plan's confirmation detail.
    const suppliersFor = (productName: string) => (supDefs.data ?? []).filter((s: any) => (s.product_names ?? []).some((n: string) => norm(productName).includes(norm(n)) || norm(n).includes(norm(productName))))
      .map((s: any) => { const c = SUP.find((x) => x.supplier_name === s.name); const detail = c ? c.detail.replace(/ (for|on) \d{4}-\d{2}-\d{2}/, "").replace(/, names attached/, "") : ""; return detail ? `${s.name} (${detail})` : s.name; });

    // Group runs by person (driver and, if different, guide)
    const byPerson = new Map<string, { staff: any; runs: { a: any; d: any; role: "driver" | "guide" }[] }>();
    const add = (id: string | null, role: "driver" | "guide", r: any) => { if (!id) return; const st = S.find((s) => s.id === id); if (!st) return; if (!byPerson.has(id)) byPerson.set(id, { staff: st, runs: [] }); byPerson.get(id)!.runs.push({ ...r, role }); };
    // Split departures carry every driver in driver_label ("Tane, Jess") but only the first in driver_id; resolve the rest by name.
    const byName = (n: string) => S.find((s) => norm(s.name) === norm(n))?.id ?? null;
    for (const r of runs) {
      const ids = new Set<string>(); if (r.a.driver_id) ids.add(r.a.driver_id);
      for (const n of String(r.a.driver_label ?? "").split(",").map((x: string) => x.trim()).filter(Boolean)) { const id = byName(n); if (id) ids.add(id); }
      for (const id of ids) add(id, "driver", r);
      if (r.a.guide_id && !ids.has(r.a.guide_id)) add(r.a.guide_id, "guide", r);
    }

    const compose = (p: { staff: any; runs: any[] }, level: number): string => {
      const blocks = p.runs.map(({ a, d, role }) => {
        const t = String(d.time).slice(0, 5);
        const veh = role === "guide" ? `with ${a.driver_label ?? "driver TBC"}` : (a.vehicle_label ?? "vehicle TBC") + (String(a.driver_label ?? "").includes(",") ? ` (with ${a.driver_label.split(",").map((x: string) => x.trim()).filter((x: string) => norm(x) !== norm(p.staff.name)).join(", ")})` : "");
        const lines = [`${t} ${d.product_name} · ${veh} · ${a.pax} pax`];
        const stops: any[] = a.pickup_sequence ?? [];
        if (stops.length) lines.push("Pickups: " + stops.map((s) => `${s.time} ${s.location}` + (level < 1 ? ` (${(s.names ?? []).map(surname).join(", ")} ×${s.pax})` : ` ×${s.pax}`)).join(", "));
        else lines.push("Pickups: none, guests meet at the depot");
        if (a.note && level < 3) lines.push(`Notes: ${a.note}`);
        const sp = suppliersFor(d.product_name); if (sp.length && level < 2) lines.push(`Suppliers: ${sp.join(", ")}`);
        return lines.join("\n");
      });
      const parts = [`Kia ora ${first(p.staff.name)}, your run for ${date} with ${operator.name}:`, ...blocks];
      if (alert) parts.push(`Alert: ${alert}.`);
      parts.push(`Run sheet: ${link}\nReply 1 when you've read this.`);
      return parts.join("\n\n");
    };
    const fit = (p: any) => { for (let l = 0; l <= 3; l++) { const b = compose(p, l); if (b.length <= MAX) return b; } return compose(p, 3).slice(0, MAX - 1) + "…"; };

    const messages: any[] = [];
    for (const p of byPerson.values()) {
      const body = fit(p);
      messages.push({ plan_id, operator_id, booking_id: null, channel: p.staff.phone ? "whatsapp" : "manual", recipient: p.staff.phone ?? p.staff.name, label: `Driver brief · ${p.staff.name}`, body, status: "draft" });
    }

    // Group digest
    const totalPax = runs.reduce((n, r) => n + (r.a.pax || 0), 0);
    const digestLines = runs.map(({ a, d }) => { const t = String(d.time).slice(0, 5); const fp = (a.pickup_sequence ?? [])[0]?.time; return `${t} ${d.product_name} · ${a.driver_label ?? "NO DRIVER"} · ${a.vehicle_label ?? "NO VEHICLE"} · ${a.pax} pax${fp ? ` · first pickup ${fp}` : ""}`; });
    const unassigned = runs.filter((r) => r.a.pax > 0 && (!r.a.driver_id || !r.a.vehicle_id)).map((r) => `${String(r.d.time).slice(0, 5)} ${r.d.product_name} needs ${!r.a.driver_id && !r.a.vehicle_id ? "a driver and a vehicle" : !r.a.driver_id ? "a driver" : "a vehicle"}.`);
    const decide = (excs.data ?? []).filter((e: any) => e.level === "bad").map((e: any) => e.title);
    const digestParts = [`${operator.name} · ${date} · ${runs.length} departures · ${totalPax} pax`, digestLines.join("\n") || "No departures."];
    if (unassigned.length) digestParts.push("Unassigned: " + unassigned.join(" "));
    if (decide.length) digestParts.push("Still to decide: " + decide.join("; "));
    if (alert) digestParts.push(`Alert: ${alert}.`);
    digestParts.push(`Run sheet: ${link}`);
    messages.push({ plan_id, operator_id, booking_id: null, channel: "manual", recipient: "Staff group", label: "Driver brief · Staff group", body: digestParts.join("\n\n"), status: "draft" });

    // Replace unsent briefs for this plan, keep sent ones for the audit trail
    await db.from("messages").delete().eq("plan_id", plan_id).is("booking_id", null).like("label", "Driver brief · %").in("status", ["draft", "held", "approved"]);
    const { data: inserted, error: ie } = await db.from("messages").insert(messages).select();
    if (ie) return json({ error: ie.message }, 500);
    await audit(operator_id, userId, "driver_brief.drafted", "plan", plan_id, { drivers: byPerson.size, messages: messages.length });
    return json({ plan_id, count: messages.length, briefs: inserted });
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
