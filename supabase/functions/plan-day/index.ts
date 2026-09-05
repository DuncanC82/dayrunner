// DayRunner planner: deterministic allocation + pickup sequencing + message drafting + supplier list + exceptions.
// Optional Claude pass rewrites message tone and exception narrative; it never changes allocations.
import { admin, audit, cors, json, requireMember } from "../_shared/auth.ts";

type Staff = { id: string; name: string; licence_class: number; p_endorsement: boolean; max_hours: number; skills: string[]; notes: string | null; active: boolean; prior_work_minutes_today?: number | null };
type Avail = { staff_id: string; available_from: string | null; available_to: string | null; unavailable: boolean; note: string | null };
type Vehicle = { id: string; name: string; seats: number; licence_required: number; status: string; features: string[]; notes: string | null; active: boolean };
type Product = { id: string; name: string; duration_minutes: number; skills_required: string[]; needs_separate_guide: boolean; pickup_lead_minutes: number; route_km?: number | null };
type Departure = { id: string; product_id: string | null; product_name: string; date: string; time: string; route_km?: number | null };
type Booking = { id: string; departure_id: string; external_ref: string | null; source: string; lead_name: string; pax: number; phone: string | null; email: string | null; pickup_location: string | null; notes: string | null; status: string };
type Supplier = { id: string; name: string; channel: string; contact: string | null; product_names: string[]; detail_template: string; confirm_by: string };

const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const hhmm = (m: number) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ----- NZ work time (Land Transport Rule: Work Time and Logbooks 2007) -----
// 5.5h continuous work -> 30 min break; 13h in a cumulative work day; 70h in a cumulative work period (then 24h off).
const WT = { CONTINUOUS: 330, BREAK: 30, DAY: 780, PERIOD: 4200, PERIOD_DAYS: 14 };
const RULE_NAME = "Land Transport Rule: Work Time and Logbooks 2007";
type Ledger = { dayMinutes: number; continuous: number; lastEnd: number | null; prior14: number };
type Shift = { start: number; end: number; work: number; contEnd: number; breaks: { after: string; minutes: number }[] };
/** Walk a work window [start,end) against a driver's ledger, inserting 30 min breaks whenever continuous work hits 5.5h. Breaks sit inside the window (a lunch stop), they do not extend it. */
function planShift(l: Ledger, start: number, end: number): Shift {
  let cont = l.lastEnd !== null && start - l.lastEnd < WT.BREAK ? l.continuous : 0;
  let t = start, work = 0; const breaks: Shift["breaks"] = [];
  while (t < end) {
    const room = WT.CONTINUOUS - cont;
    if (room <= 0) { breaks.push({ after: hhmm(t), minutes: WT.BREAK }); t += WT.BREAK; cont = 0; continue; }
    const step = Math.min(room, end - t); work += step; cont += step; t += step;
  }
  return { start, end, work, contEnd: cont, breaks };
}
const commit = (l: Ledger, sh: Shift) => { l.dayMinutes += sh.work; l.lastEnd = sh.end; l.continuous = sh.contEnd; };
const h = (m: number) => (m / 60).toFixed(1) + "h";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { operator_id, date, alerts } = await req.json();
    if (!operator_id || !date) return json({ error: "operator_id and date required" }, 400);
    const userId = await requireMember(req, operator_id);
    const db = admin();

    const [op, staff, avail, vehicles, products, departures, rules, suppliers] = await Promise.all([
      db.from("operators").select("*").eq("id", operator_id).single(),
      db.from("staff").select("*").eq("operator_id", operator_id).eq("active", true),
      db.from("staff_availability").select("*").eq("operator_id", operator_id).eq("date", date),
      db.from("vehicles").select("*").eq("operator_id", operator_id).eq("active", true),
      db.from("products").select("*").eq("operator_id", operator_id),
      db.from("departures").select("*").eq("operator_id", operator_id).eq("date", date).neq("status", "cancelled").order("time"),
      db.from("rules").select("*").eq("operator_id", operator_id),
      db.from("suppliers").select("*").eq("operator_id", operator_id).eq("active", true),
    ]);
    if (op.error) return json({ error: op.error.message }, 500);
    const operator = op.data;
    const rule = Object.fromEntries((rules.data ?? []).map((r: any) => [r.key, r.value]));
    const regime: "logbook" | "none" = rule.worktime_regime === "none" ? "none" : "logbook";
    const kmPerStop = Number(rule.km_per_stop ?? 4);
    const prepMin = Number(rule.prep_minutes ?? 15);
    const childAge = Number(rule.child_seat_age ?? 7);
    const deps: Departure[] = departures.data ?? [];
    if (deps.length === 0) return json({ error: "No departures on that date. Import bookings first." }, 400);
    const depIds = deps.map((d) => d.id);
    const { data: bookingsAll } = await db.from("bookings").select("*").eq("operator_id", operator_id).in("departure_id", depIds).neq("status", "cancelled");
    const bookings: Booking[] = bookingsAll ?? [];

    // Cumulative work period: work_log minutes over the 13 days before D (14-day window including D).
    const since = new Date(date + "T00:00:00Z"); since.setUTCDate(since.getUTCDate() - (WT.PERIOD_DAYS - 1));
    const { data: logRows } = await db.from("work_log").select("staff_id, minutes_work").eq("operator_id", operator_id).gte("date", since.toISOString().slice(0, 10)).lt("date", date);
    const prior14 = new Map<string, number>(); for (const r of (logRows ?? []) as any[]) prior14.set(r.staff_id, (prior14.get(r.staff_id) ?? 0) + Number(r.minutes_work || 0));
    const S: Staff[] = staff.data ?? []; const V: Vehicle[] = vehicles.data ?? []; const P: Product[] = products.data ?? []; const SUP: Supplier[] = suppliers.data ?? [];
    const availBy = new Map<string, Avail>(); for (const a of (avail.data ?? []) as Avail[]) availBy.set(a.staff_id, a);
    const prodOf = (d: Departure) => P.find((p) => p.id === d.product_id) ?? P.find((p) => norm(p.name) === norm(d.product_name)) ?? null;

    // ----- state -----
    const busyUntil = new Map<string, number>(); const vehBusyUntil = new Map<string, number>();
    const ledgers = new Map<string, Ledger>(); const ledger = (s: Staff) => { let l = ledgers.get(s.id); if (!l) { l = { dayMinutes: Number(s.prior_work_minutes_today ?? 0), continuous: Number(s.prior_work_minutes_today ?? 0), lastEnd: null, prior14: prior14.get(s.id) ?? 0 }; ledgers.set(s.id, l); } return l; };
    const kmBy = new Map<string, number>(); const seventyWarned = new Set<string>();
    const exceptions: any[] = []; const allocations: any[] = []; const messages: any[] = []; const confirmations: any[] = [];
    const stopOrder: string[] = (operator.stop_order ?? []).map(norm);

    // Sort: by time, then longer first
    const work = deps.map((d) => ({ d, p: prodOf(d), bk: bookings.filter((b) => b.departure_id === d.id) }))
      .sort((a, b) => mins(a.d.time) - mins(b.d.time) || (b.p?.duration_minutes ?? 240) - (a.p?.duration_minutes ?? 240));

    // vehicle warnings
    for (const v of V) if (v.status === "out") exceptions.push({ level: "warn", title: `${v.name} is out of service`, detail: v.notes ?? "Marked out of service in the fleet list.", options: ["Return to service when fixed", "Hire a replacement"] });

    for (const { d, p, bk } of work) {
      const pax = bk.reduce((a, b) => a + (b.pax || 0), 0);
      const start = mins(d.time); const dur = p?.duration_minutes ?? 240; const end = start + dur;
      const needsChildSeat = bk.some((b) => /child seat|age [0-6]\b|toddler|infant/i.test(b.notes ?? ""));
      const needsWheelchair = bk.some((b) => /wheelchair/i.test(b.notes ?? ""));
      const notes: string[] = []; let status: "ok" | "warn" | "bad" = "ok"; let depWork = 0; let depBreaks: Shift["breaks"] = [];
      if (!p) { notes.push(`Product "${d.product_name}" is not in your product list; using defaults.`); status = "warn"; exceptions.push({ level: "warn", title: `Unknown product: ${d.product_name}`, detail: "The booking feed used a product name that is not set up. Duration and skills defaulted.", options: ["Add the product in Settings", "Fix the name at source"] }); }
      if (pax === 0) { allocations.push({ departure_id: d.id, pax, status: "warn", note: "No bookings. Consider cancelling the departure.", pickup_sequence: [] }); continue; }

      // ----- pickup sequence -----
      const lead = p?.pickup_lead_minutes ?? Number(rule.pickup_lead_minutes ?? 25);
      const withPickup = bk.filter((b) => b.pickup_location).sort((a, b) => {
        const ia = stopOrder.findIndex((s) => norm(a.pickup_location!).includes(s) || s.includes(norm(a.pickup_location!)));
        const ib = stopOrder.findIndex((s) => norm(b.pickup_location!).includes(s) || s.includes(norm(b.pickup_location!)));
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      });
      const stops: { location: string; time: string; names: string[]; pax: number }[] = [];
      for (const b of withPickup) { const last = stops[stops.length - 1]; if (last && norm(last.location) === norm(b.pickup_location!)) { last.names.push(b.lead_name); last.pax += b.pax; } else stops.push({ location: b.pickup_location!, time: "", names: [b.lead_name], pax: b.pax }); }
      const first = start - lead - Math.max(0, stops.length - 1) * 5;
      stops.forEach((s, i) => { s.time = hhmm(first + i * 5); });
      const pickupTimeFor = (b: Booking) => stops.find((s) => norm(s.location) === norm(b.pickup_location ?? ""))?.time ?? d.time.slice(0, 5);
      if (bk.some((b) => !b.pickup_location)) notes.push(`${bk.filter((b) => !b.pickup_location).length} booking(s) have no pickup location; they meet at the depot.`);
      // Work window for whoever runs this departure: prep -> pickup run -> tour -> return + prep.
      const shiftStart = (stops.length ? first : start) - prepMin; const shiftEnd = end + prepMin;
      const routeKm = Number(d.route_km ?? p?.route_km ?? 0); const runKm = stops.length * kmPerStop + routeKm;

      // ----- vehicle -----
      const free = (v: Vehicle) => v.status !== "out" && (vehBusyUntil.get(v.id) ?? -1) <= shiftStart;
      const hasFeat = (v: Vehicle, re: RegExp) => v.features.some((f) => re.test(f));
      const featScore = (v: Vehicle) => (needsChildSeat && !hasFeat(v, /child/i) ? 1 : 0) + (needsWheelchair && !hasFeat(v, /wheelchair/i) ? 1 : 0);
      // Prefer: healthy single vehicle → split across healthy vehicles → single with a warning → split including warnings.
      const pickSingle = (pool: Vehicle[]) => pool.filter((v) => v.seats >= pax).sort((a, b) => featScore(a) - featScore(b) || a.seats - b.seats)[0];
      const pickSplit = (pool: Vehicle[]) => { const out: Vehicle[] = []; let acc = 0; for (const v of [...pool].sort((a, b) => featScore(a) - featScore(b) || b.seats - a.seats)) { out.push(v); acc += v.seats; if (acc >= pax) return out; } return []; };
      const healthy = V.filter((v) => free(v) && v.status === "ok"); const any = V.filter(free);
      let chosen: Vehicle[] = []; const s1 = pickSingle(healthy); if (s1) chosen = [s1]; else { const sp = pickSplit(healthy); if (sp.length) chosen = sp; else { const s2 = pickSingle(any); if (s2) chosen = [s2]; else chosen = pickSplit(any); } }
      if (chosen.length) {
        if (needsChildSeat && !chosen.some((v) => hasFeat(v, /child/i))) { status = "warn"; notes.push(`Child seat needed: fit one to ${chosen[0].name} before departure.`); }
        if (needsWheelchair && !chosen.some((v) => hasFeat(v, /wheelchair/i))) { status = "warn"; notes.push(`Folding wheelchair on board: confirm ${chosen[0].name} has boot space.`); }
      }
      if (chosen.length === 0) {
        status = "bad";
        exceptions.push({ level: "bad", title: `${d.time.slice(0, 5)} ${d.product_name}: no vehicle for ${pax} pax`, detail: `Every suitable vehicle is allocated or out of service at ${d.time.slice(0, 5)}.`, options: ["Hire a van for the afternoon", "Split into two runs", "Move guests to another departure", "Cancel and rebook"] });
        notes.push("No vehicle available.");
      } else {
        for (const v of chosen) { vehBusyUntil.set(v.id, shiftEnd); if (v.status === "warning") { status = status === "bad" ? "bad" : "warn"; notes.push(`${v.name} has a warning: ${v.notes ?? "check before departure"}.`); } }
        if (chosen.length > 1) { notes.push(`${pax} pax split across ${chosen.map((v) => v.name).join(" + ")}.`); status = status === "bad" ? "bad" : "warn"; }
      }

      // ----- drivers (one per vehicle) -----
      const needLic = Math.max(1, ...chosen.map((v) => v.licence_required));
      const skillsReq = (p?.skills_required ?? []).map(norm);
      const driverOk = (s: Staff, v?: Vehicle) => {
        const a = availBy.get(s.id);
        if (a?.unavailable) return false;
        if (a?.available_from && mins(a.available_from) > shiftStart) return false;
        if (a?.available_to && mins(a.available_to) < shiftEnd) return false;
        if ((busyUntil.get(s.id) ?? -1) > shiftStart) return false;
        if (!s.p_endorsement) return false;
        if (s.licence_class < (v?.licence_required ?? needLic)) return false;
        return true;
      };
      const drivers: Staff[] = []; const driverNotes: string[] = [];
      for (const v of chosen) {
        const cands = S.filter((s) => driverOk(s, v) && !drivers.includes(s)).sort((a, b) => {
          const sa = skillsReq.every((k) => a.skills.map(norm).includes(k)) ? 0 : 1; const sb = skillsReq.every((k) => b.skills.map(norm).includes(k)) ? 0 : 1;
          if (sa !== sb) return sa - sb;
          return ledger(a).dayMinutes - ledger(b).dayMinutes;
        });
        // Enforce the 13h cumulative work day: prefer a driver who stays legal; fall back to the least-loaded and raise.
        const dayCap = (s: Staff) => regime === "logbook" ? Math.min(WT.DAY, Math.round(s.max_hours * 60)) : Math.round(s.max_hours * 60);
        const fits = (s: Staff) => ledger(s).dayMinutes + planShift(ledger(s), shiftStart, shiftEnd).work <= dayCap(s);
        const pick = cands.find(fits) ?? cands[0];
        if (!pick) { status = "bad"; exceptions.push({ level: "bad", title: `${d.time.slice(0, 5)} ${d.product_name}: no driver for ${v.name}`, detail: `No available driver holds a class ${v.licence_required} licence with P endorsement and free hours from ${d.time.slice(0, 5)} to ${hhmm(end)}.`, options: ["Call a casual", "Swap a driver from a later departure", "Cancel this departure"] }); continue; }
        drivers.push(pick);
        const L = ledger(pick); const sh = planShift(L, shiftStart, shiftEnd); commit(L, sh); busyUntil.set(pick.id, shiftEnd);
        kmBy.set(pick.id, (kmBy.get(pick.id) ?? 0) + runKm);
        depWork = Math.max(depWork, sh.work); depBreaks = sh.breaks;
        if (sh.breaks.length) driverNotes.push(`${pick.name}: 30 min break required after ${sh.breaks.map((b) => b.after).join(" and ")} (5.5h continuous work).`);
        if (regime === "logbook" && L.dayMinutes > WT.DAY) { status = "bad"; exceptions.push({ level: "bad", title: `${pick.name} would work ${h(L.dayMinutes)} — over the 13h work day`, detail: `${RULE_NAME}: maximum 13 hours work time in a cumulative work day. ${d.product_name} is ${h(sh.work)} of work (${hhmm(shiftStart)}–${hhmm(shiftEnd)} incl. ${prepMin} min prep each end, less ${sh.breaks.length * WT.BREAK} min breaks)${Number(pick.prior_work_minutes_today ?? 0) ? `, after ${h(Number(pick.prior_work_minutes_today))} already worked today` : ""}.`, options: ["Swap for a driver with hours left", "Pair with a second driver for the return leg", "Shorten the itinerary", "Mark prior hours today as rest if entered wrongly"] }); driverNotes.push(`${pick.name} over 13h (${h(L.dayMinutes)}).`); }
        else if (L.dayMinutes > dayCap(pick)) { status = status === "bad" ? "bad" : "warn"; exceptions.push({ level: "warn", title: `${pick.name} over their ${pick.max_hours}h operator limit on ${d.product_name}`, detail: `Operator policy (max_hours) for ${pick.name} is ${pick.max_hours}h; the plan puts them at ${h(L.dayMinutes)}. Legal cap is ${regime === "logbook" ? "13h" : "not enforced (worktime_regime = none)"}.`, options: ["Accept for today", "Swap for a driver with more hours", "Raise the driver's max hours in Setup"] }); driverNotes.push(`${pick.name} over operator limit (${h(L.dayMinutes)}).`); }
        if (regime === "logbook" && !seventyWarned.has(pick.id) && L.prior14 + L.dayMinutes > WT.PERIOD) { seventyWarned.add(pick.id); exceptions.push({ level: "warn", title: `${pick.name} passes 70h in the cumulative work period`, detail: `${RULE_NAME}: no more than 70 hours work time between 24-hour rest breaks. Work log shows ${h(L.prior14)} in the last ${WT.PERIOD_DAYS - 1} days; tomorrow adds ${h(L.dayMinutes)} = ${h(L.prior14 + L.dayMinutes)}. If ${pick.name} has had a continuous 24h break since, record it in the work log and re-plan.`, options: ["Give a 24h rest day before this departure", "Swap for a driver with hours left", "Record the last 24h break in the work log"] }); }
        if (skillsReq.length && !skillsReq.every((k) => pick.skills.map(norm).includes(k))) { status = status === "bad" ? "bad" : "warn"; driverNotes.push(`${pick.name} has not guided ${d.product_name} before; brief them and call at departure minus 60.`); }
      }
      let guide: Staff | null = null;
      if (p?.needs_separate_guide) { guide = S.find((s) => !drivers.includes(s) && driverOk(s) && skillsReq.every((k) => s.skills.map(norm).includes(k))) ?? null; if (!guide) { status = status === "bad" ? "bad" : "warn"; driverNotes.push("No separate guide available; driver guides."); } else { const L = ledger(guide); const sh = planShift(L, shiftStart, shiftEnd); commit(L, sh); busyUntil.set(guide.id, shiftEnd); if (regime === "logbook" && L.dayMinutes > WT.DAY) { status = status === "bad" ? "bad" : "warn"; exceptions.push({ level: "warn", title: `${guide.name} (guide) would work ${h(L.dayMinutes)} — over 13h`, detail: `${RULE_NAME}: guiding is paid work and counts as work time even when not driving.`, options: ["Swap the guide", "Driver guides instead"] }); } } }

      allocations.push({ departure_id: d.id, pax, status, vehicle_id: chosen[0]?.id ?? null, vehicle_label: chosen.map((v) => v.name).join(" + ") || null, driver_id: drivers[0]?.id ?? null, driver_label: drivers.map((s) => s.name).join(", ") || null, guide_id: guide?.id ?? drivers[0]?.id ?? null, guide_label: guide?.name ?? (drivers[0] ? `${drivers[0].name} (driver-guide)` : null), pickup_sequence: stops, km: Math.round(runKm * 10) / 10, work_minutes: depWork || null, breaks: depBreaks, note: [...notes, ...driverNotes].join(" ") || null, _dep: d });

      // ----- messages -----
      const held = status === "bad";
      for (const b of bk) {
        const t = pickupTimeFor(b); const where = b.pickup_location ?? "our depot";
        const extras: string[] = [];
        if (needsChildSeat && /child|age|toddler|infant/i.test(b.notes ?? "")) extras.push("We have a child seat fitted.");
        if (/vegetarian|vegan|gluten|dairy|allerg/i.test(b.notes ?? "")) extras.push("Your dietary request is noted with our lunch stop.");
        if (/wheelchair/i.test(b.notes ?? "")) extras.push("Our vehicle fits a folding wheelchair.");
        if (/no alcohol/i.test(b.notes ?? "")) extras.push("We have noted no alcohol; there will be juice and the food is included.");
        const alertLine = alerts ? ` ${String(alerts).split(".")[0]}.` : "";
        const first = b.lead_name.split(" ")[0];
        const body = `Kia ora ${first}, this is ${operator.name}. Your ${d.product_name} pickup is ${t} tomorrow from ${where}.${extras.length ? " " + extras.join(" ") : ""}${alertLine} Reply 1 to confirm.`;
        if (b.phone) messages.push({ booking_id: b.id, channel: "whatsapp", recipient: b.phone, label: `${b.lead_name} · ${b.external_ref ?? ""} · WhatsApp`, body, status: held ? "held" : "draft" });
        else if (b.email) messages.push({ booking_id: b.id, channel: "email", recipient: b.email, label: `${b.lead_name} · ${b.external_ref ?? ""} · Email (no phone from ${b.source})`, body, status: held ? "held" : "draft" });
        else { messages.push({ booking_id: b.id, channel: "manual", recipient: where, label: `${b.lead_name} · ${b.external_ref ?? ""} · Hotel reception note`, body: `Please pass to ${b.lead_name}: ${operator.name} ${d.product_name} pickup ${t} at ${where} main entrance.`, status: "held" }); exceptions.push({ level: "warn", title: `${b.lead_name} has no contact details (${b.source})`, detail: "OTA booking with no phone or email. A note to the hotel is drafted; consider messaging through the OTA.", options: ["Send hotel note", "Message via OTA inbox"] }); }
      }

      // ----- suppliers -----
      for (const s of SUP) {
        if (!s.product_names.map(norm).some((n) => norm(d.product_name).includes(n) || n.includes(norm(d.product_name)))) continue;
        const dietary = bk.filter((b) => /vegetarian|vegan|gluten|dairy|allerg/i.test(b.notes ?? "")).length;
        const detail = s.detail_template.replace("{date}", date).replace("{pax}", String(pax)).replace("{product}", d.product_name).replace("{time}", d.time.slice(0, 5)) + (dietary ? ` (${dietary} dietary)` : "");
        confirmations.push({ supplier_id: s.id, supplier_name: s.name, detail, due_label: s.confirm_by, status: held ? "hold" : "pending" });
      }
    }

    if (alerts) exceptions.unshift({ level: "warn", title: "External alert entered for tomorrow", detail: String(alerts), options: ["Adjust departure times", "Brief drivers", "Hold guest messages until decided"] });

    // ----- optional Claude pass -----
    let generated_by = "allocator";
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (key && messages.length) {
      try {
        const prompt = `You are DayRunner, the operations assistant for ${operator.name}, a tour operator. Rewrite the following guest messages in this voice: ${operator.voice}. Keep every fact (time, place, product, extras). Keep "Reply 1 to confirm". Return JSON only: {"messages":[{"i":index,"body":"..."}],"summary":"two sentences describing tomorrow for the coordinator"}.\n\nAlerts: ${alerts ?? "none"}\nExceptions: ${JSON.stringify(exceptions.map((e) => e.title))}\nMessages: ${JSON.stringify(messages.map((m, i) => ({ i, body: m.body })))}`;
        const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 4000, messages: [{ role: "user", content: prompt }] }) });
        if (r.ok) { const out = await r.json(); const text = out.content?.[0]?.text ?? ""; const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); for (const m of j.messages ?? []) if (messages[m.i] && m.body) messages[m.i].body = m.body; generated_by = "allocator+claude"; (globalThis as any).__summary = j.summary; }
      } catch (_) { /* keep deterministic output */ }
    }

    // ----- persist -----
    await db.from("plans").delete().eq("operator_id", operator_id).eq("date", date);
    const summary = { departures: deps.length, pax: bookings.reduce((a, b) => a + b.pax, 0), km: Math.round([...kmBy.values()].reduce((a, b) => a + b, 0)), work_hours: Math.round([...ledgers.values()].reduce((a, l) => a + l.dayMinutes, 0) / 6) / 10, worktime_regime: regime, messages: messages.length, exceptions: exceptions.filter((e) => e.level === "bad").length, warnings: exceptions.filter((e) => e.level === "warn").length, narrative: (globalThis as any).__summary ?? null };
    const { data: plan, error: pe } = await db.from("plans").insert({ operator_id, date, status: "draft", generated_by, summary, alerts: alerts ?? null }).select().single();
    if (pe) return json({ error: pe.message }, 500);
    const pid = plan.id;
    if (allocations.length) await db.from("allocations").insert(allocations.map(({ _dep, ...a }) => ({ ...a, plan_id: pid, operator_id })));
    if (messages.length) await db.from("messages").insert(messages.map((m) => ({ ...m, plan_id: pid, operator_id })));
    if (confirmations.length) await db.from("supplier_confirmations").insert(confirmations.map((c) => ({ ...c, plan_id: pid, operator_id })));
    if (exceptions.length) await db.from("exceptions").insert(exceptions.map((e) => ({ ...e, plan_id: pid, operator_id })));
    // Planned work per driver for D, so the 70h check sees it on later days. Source 'plan' is replaced on every re-plan.
    const logs = [...ledgers.entries()].filter(([, l]) => l.dayMinutes > 0).map(([staff_id, l]) => ({ operator_id, staff_id, date, minutes_work: Math.round(l.dayMinutes - Number(S.find((x) => x.id === staff_id)?.prior_work_minutes_today ?? 0)), minutes_drive: 0, km: Math.round((kmBy.get(staff_id) ?? 0) * 10) / 10, source: "plan" }));
    if (logs.length) await db.from("work_log").upsert(logs, { onConflict: "staff_id,date,source" });
    await audit(operator_id, userId, "plan.generated", "plan", pid, summary);
    return json({ plan_id: pid, summary });
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: String((e as any)?.message ?? e) }, 500);
  }
});
