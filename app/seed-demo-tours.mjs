// Second demo workspace, built from Jackie's walkthrough: a multi-day charter tour company.
// demo+tours@prompt6.com / RunTheTour-2026. Re-runnable: wipes and reseeds the operator's data.
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
const URL = "https://tylttoheoazyvbuixrrk.supabase.co", ANON = "sb_publishable_YtPWHlhEtmjBi3dEt-xMIg_MeIitBSS";
const EMAIL = "demo+tours@prompt6.com", PASS = "RunTheTour-2026";
const sb = createClient(URL, ANON);
let { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
if (error) {
  const keys = JSON.parse(execSync("supabase projects api-keys --project-ref tylttoheoazyvbuixrrk -o json").toString());
  const admin = createClient(URL, keys.find((k) => k.name === "service_role").api_key, { auth: { persistSession: false } });
  const r = await admin.auth.admin.createUser({ email: EMAIL, password: PASS, email_confirm: true, user_metadata: { operator_name: "Kea Coach Tours" } });
  if (r.error) throw r.error;
  ({ data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS })); if (error) throw error;
}
const { data: m } = await sb.from("memberships").select("operator_id").limit(1).single(); const oid = m.operator_id;
const must = async (p) => { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; };

// ---- wipe ----
for (const t of ["stop_notes", "stops", "rooming", "tour_days", "bookings", "departures", "tours", "transport_requests", "supplier_confirmations", "messages", "exceptions", "allocations", "plans", "suppliers", "products", "staff", "vehicles", "work_log"]) await sb.from(t).delete().eq("operator_id", oid);

// ---- operator ----
await must(sb.from("operators").update({ name: "Kea Coach Tours", voice: "Warm, plain New Zealand English, trade-to-trade. Start with Kia ora. Short sentences. Sign off Ngā mihi, Kea Coach Tours.", stop_order: ["Christchurch Airport", "Christchurch Bus Interchange", "Peppers Bluewater Tekapo", "Copthorne Lakefront Queenstown", "Rainforest Retreat Franz Josef", "Bealey Hotel"], settings: { ops_mode: "charter", app_url: "https://duncanc82.github.io/dayrunner" } }).eq("id", oid));
await sb.from("rules").upsert([{ operator_id: oid, key: "worktime_regime", value: "none" }, { operator_id: oid, key: "pickup_lead_minutes", value: "15" }], { onConflict: "operator_id,key" });

// ---- suppliers (category + email, the way Jackie's Gmail folders are organised) ----
const SUP = [
  ["Ritchies Charter Christchurch", "transport", "charters@example-ritchies.test", "03 555 0100", "Vehicle request", "Confirm vehicle, driver, price and inclusions for {date}"],
  ["Peppers Bluewater Resort, Tekapo", "accommodation", "reservations@example-bluewater.test", "03 555 0201", "Overnight", "Rooming list for {date}: {pax} pax"],
  ["Copthorne Lakefront, Queenstown", "accommodation", "groups@example-copthorne.test", "03 555 0202", "Overnight", "Rooming list for {date}: {pax} pax, 2 nights"],
  ["Rainforest Retreat, Franz Josef", "accommodation", "stay@example-rainforest.test", "03 555 0203", "Overnight", "Rooming list for {date}: {pax} pax"],
  ["Bealey Hotel, Arthur's Pass", "accommodation", "bookings@example-bealey.test", "03 555 0204", "Overnight", "Rooming list for {date}: {pax} pax; dinner at 18:30"],
  ["Glacier Explorers", "activity", "bookings@example-glacierexplorers.test", "03 555 0301", "Glacier Explorers", "Boat tour 14:00 on {date}: {pax} pax, weather call by 08:00"],
  ["Skyline Gondola", "activity", "groups@example-skyline.test", "03 555 0302", "Skyline Gondola", "Gondola + luge 08:30 on {date}: {pax} pax"],
  ["Adrenaline Forest Queenstown", "activity", "hello@example-adrenaline.test", "03 555 0303", "Adrenaline Forest", "High ropes 09:45 on {date}: {pax} pax (5 children)"],
  ["Vudu Cafe, Queenstown", "meal_breakfast", "kitchen@example-vudu.test", "03 555 0401", "Breakfast", "Group breakfast 07:00 on {date}: {pax} pax"],
  ["Fergburger", "meal_lunch", null, "03 555 0402", "Lunch", "Walk-in lunch on {date}: {pax} pax, pay direct"],
  ["Alice May Restaurant, Franz Josef", "meal_dinner", "bookings@example-alicemay.test", "03 555 0403", "Dinner", "Group dinner 19:00 on {date}: {pax} pax (1 gluten-free child)"],
  ["The Landing Bar & Restaurant", "meal_lunch", "bookings@example-landing.test", "03 555 0404", "Lunch", "Group lunch 12:15 on {date}: {pax} pax"],
  ["Botswana Butchery, Queenstown", "meal_dinner", "reservations@example-botswana.test", "03 555 0405", "Dinner", "Group dinner 19:00 on {date}: {pax} pax"],
];
const suppliers = await must(sb.from("suppliers").insert(SUP.map(([name, category, email, contact, prod, tpl]) => ({ operator_id: oid, name, category, email, contact, channel: email ? "email" : "phone", product_names: [prod], detail_template: tpl, confirm_by: category.startsWith("meal") ? "10:00 day before" : "17:00 day before" })).map((r) => ({ ...r, product_names: r.product_names }))).select());
const sup = (n) => suppliers.find((x) => x.name.startsWith(n));

// ---- tour ----
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const D = [1, 2, 3, 4, 5].map(day);
const tour = await must(sb.from("tours").insert({ operator_id: oid, name: "Southern Circuit · Reid & Okafor families", start_date: D[0], end_date: D[4], group_pax: 16, status: "confirmed", adults: 11, children: 5, boys: 3, girls: 2, group_notes: "Two families travelling together (Reid, Okafor) plus five adults from the Auckland walking club. Ava Reid (6) is gluten-free. Group leader: Marcus Reid, +64 21 555 0190. Two guests are nervous on ropes; Adrenaline Forest has a ground course option.", notes: "Charter: 18-seat Sprinter with trailer from Ritchies. Driver's meals and accommodation included in the charter price." }).select().single());
await must(sb.from("rooming").insert([
  { operator_id: oid, tour_id: tour.id, room_type: "family", occupants: "Marcus + Priya Reid, Ava (6) + Noah (9)", count: 1, notes: "Interconnecting if possible; rollaway for Noah", sequence: 1 },
  { operator_id: oid, tour_id: tour.id, room_type: "family", occupants: "Tunde + Grace Okafor, Zara (11) + Femi (13)", count: 1, notes: "", sequence: 2 },
  { operator_id: oid, tour_id: tour.id, room_type: "single", occupants: "Helen Okafor (grandmother) + Lila (4)", count: 1, notes: "Cot or rollaway for Lila", sequence: 3 },
  { operator_id: oid, tour_id: tour.id, room_type: "twin", occupants: "Walking club adults", count: 2, notes: "", sequence: 4 },
  { operator_id: oid, tour_id: tour.id, room_type: "single", occupants: "Walking club adult", count: 1, notes: "Ground floor please, knee", sequence: 5 },
]));
const DAYS = [
  { title: "Christchurch to Tekapo", overnight: "Peppers Bluewater Resort, Tekapo", inclusions: { transport: true, breakfast: false, lunch: false, dinner: true }, overview: "Meet the group off the morning flights at Christchurch Airport, load the trailer and head inland. Lunch stop in Geraldine, then the Church of the Good Shepherd at Tekapo before dinner and the night at Bluewater." },
  { title: "Tekapo to Mount Cook to Queenstown", overnight: "Copthorne Lakefront, Queenstown", inclusions: { transport: true, breakfast: true, lunch: true, dinner: false }, overview: "Early breakfast, then up to Mount Cook for Glacier Explorers at 14:00. Weather call at 08:00. Long drive to Queenstown afterwards; dinner is free choice in town." },
  { title: "Queenstown", overnight: "Copthorne Lakefront, Queenstown", inclusions: { transport: true, breakfast: true, lunch: false, dinner: true }, overview: "Skyline Gondola and luge first thing, Adrenaline Forest for the kids and the brave, Fergburger lunch, free afternoon, group dinner at Botswana Butchery." },
  { title: "Queenstown to Franz Josef", overnight: "Rainforest Retreat, Franz Josef", inclusions: { transport: true, breakfast: true, lunch: false, dinner: true }, overview: "Breakfast at Vudu, then the long haul over Haast Pass to the West Coast. Photo stops at Thunder Creek Falls and Knights Point. Dinner at Alice May, overnight Rainforest Retreat." },
  { title: "Franz Josef to Christchurch", overnight: "Bealey Hotel, Arthur's Pass (dinner) then Christchurch drop-off", inclusions: { transport: true, breakfast: true, lunch: true, dinner: true }, overview: "Glacier valley walk in the morning, lunch at The Landing in Hokitika, over Arthur's Pass with dinner at the Bealey, then into Christchurch for the airport and hotel drop-offs." },
];
const days = await must(sb.from("tour_days").insert(DAYS.map((d, i) => ({ tour_id: tour.id, operator_id: oid, date: D[i], day_number: i + 1, title: d.title, overnight_location: d.overnight, inclusions: d.inclusions, overview: d.overview }))).select());
const dayId = (n) => days.find((d) => d.day_number === n).id;

// ---- departures (one per day, linked to the tour day) + the group as bookings ----
const products = await must(sb.from("products").insert(DAYS.map((d, i) => ({ operator_id: oid, name: `Day ${i + 1}: ${d.title}`, duration_minutes: 600, pickup_lead_minutes: 15 }))).select());
const deps = await must(sb.from("departures").insert(DAYS.map((d, i) => ({ operator_id: oid, product_id: products[i].id, product_name: products[i].name, date: D[i], time: i === 0 ? "11:00" : "08:00", tour_id: tour.id, tour_day_id: dayId(i + 1) }))).select());
const PARTY = [
  ["Marcus Reid", 4, "+64 21 555 0190", "marcus@example.com", "NZ541 arr 10:20 from Auckland. Ava (6) gluten-free."],
  ["Tunde Okafor", 4, "+64 27 555 0044", "tunde@example.com", "NZ541 arr 10:20 from Auckland."],
  ["Helen Okafor", 2, "+64 21 555 0178", null, "NZ8365 arr 10:55 from Wellington. Lila (4) needs a child seat."],
  ["Aroha Wilson", 2, "+64 22 555 0156", "aroha@example.com", "Driving in, meeting at the airport pickup lane."],
  ["Ben Cooper", 1, "+64 27 555 0999", null, "JQ225 arr 09:50 from Auckland."],
  ["Yuki Tanaka", 2, null, "yuki@example.com", "Arriving by InterCity coach 10:30, Bus Interchange. Knee, ground floor rooms."],
  ["Sofia Alvarez", 1, "+64 21 555 0333", null, "NZ541 arr 10:20 from Auckland."],
];
const PICK = ["Christchurch Airport", "Peppers Bluewater Tekapo", "Copthorne Lakefront Queenstown", "Copthorne Lakefront Queenstown", "Rainforest Retreat Franz Josef"];
const rows = [];
deps.forEach((dep, i) => PARTY.forEach(([name, pax, phone, email, note], j) => rows.push({ operator_id: oid, departure_id: dep.id, external_ref: `SC-${String(i + 1)}${String(j + 1).padStart(2, "0")}`, source: "direct", lead_name: name, pax, phone, email, pickup_location: i === 0 ? (j === 3 ? "Christchurch Airport" : j === 5 ? "Christchurch Bus Interchange" : "Christchurch Airport") : PICK[i], notes: i === 0 ? note : (j === 0 ? "Ava (6) gluten-free" : j === 2 ? "Child seat for Lila (4)" : null) })));
await must(sb.from("bookings").insert(rows));

// ---- stops with address / phone / reference / blurb + audience notes ----
const S = (n, time, name, category, supplierName, address, phone, reference, blurb, notes = []) => ({ n, time, name, category, supplierName, address, phone, reference, blurb, notes });
const STOPS = [
  S(1, "10:20", "Group arrivals, Christchurch Airport", "transport", null, "30 Durey Rd, Harewood, Christchurch", "03 555 0100", "Charter CHC-7781", "Meet NZ541 (10:20), NZ8365 (10:55), JQ225 (09:50) at domestic arrivals. Coach in the pickup lane bay 4.", [["driver", "Bay 4 pickup lane, trailer needs the long bay. Ben Cooper lands first at 09:50; hold him at the cafe."], ["guide", "Yuki Tanaka comes by InterCity to the Bus Interchange 10:30; second pickup on the way out."], ["group", "Please keep togs and a jacket in your day bag, the trailer is packed for the day."]]),
  S(1, "12:30", "Lunch stop, Geraldine", "meal_lunch", null, "Talbot St, Geraldine", null, null, "Free-choice lunch, 45 minutes. Barkers for the kids.", [["guide", "Pay-direct lunch; remind the group cash or card."]]),
  S(1, "15:30", "Church of the Good Shepherd", "activity", null, "Pioneer Dr, Lake Tekapo", null, null, "Twenty-minute photo stop. No booking needed.", [["driver", "Coach park is on Pioneer Dr, not the church carpark."]]),
  S(1, "18:30", "Dinner, Peppers Bluewater", "meal_dinner", "Peppers Bluewater", "State Highway 8, Lake Tekapo", "03 555 0201", "PB-44120", "Group dinner in Rakinui restaurant.", [["guide", "Gluten-free meal for Ava pre-ordered."]]),
  S(1, null, "Overnight, Peppers Bluewater Resort", "accommodation", "Peppers Bluewater", "State Highway 8, Lake Tekapo", "03 555 0201", "PB-44120", "7 rooms per rooming list. Check-in from 15:00.", [["guide", "Ground-floor room for the walking-club single, knee."]]),
  S(2, "07:00", "Breakfast, Peppers Bluewater", "meal_breakfast", "Peppers Bluewater", "State Highway 8, Lake Tekapo", "03 555 0201", "PB-44120", "Buffet from 06:30. Depart 08:00 sharp.", []),
  S(2, "14:00", "Glacier Explorers", "activity", "Glacier Explorers", "Hermitage Hotel, Terrace Rd, Mount Cook", "03 555 0301", "GE-5567", "Boat among the icebergs on the Tasman terminal lake. 2.5 hours incl. the walk in.", [["guide", "Weather call by 08:00, confirm with Glacier Explorers. Check in at the Hermitage activities desk 30 min prior."], ["driver", "Coach park behind the Hermitage, not the front loop."], ["group", "Warm layers and closed shoes for the glacier walk. Nothing in pockets on the boat."]]),
  S(2, null, "Overnight, Copthorne Lakefront", "accommodation", "Copthorne Lakefront", "Frankton Rd, Queenstown", "03 555 0202", "CL-9020", "Two nights. Rooming list sent.", [["guide", "Late arrival ~19:30; dinner free choice, suggest Fergburger takeaway."]]),
  S(3, "07:00", "Breakfast, Vudu Cafe", "meal_breakfast", "Vudu Cafe", "16 Rees St, Queenstown", "03 555 0401", "VC-4410", "Group table booked. Walk from the hotel or coach at 06:50.", []),
  S(3, "08:30", "Skyline Gondola", "activity", "Skyline Gondola", "Brecon St, Queenstown", "03 555 0302", "SG-2231", "Gondola to Bob's Peak plus 3 luge rides each.", [["guide", "Check in 20 min prior, pick up tickets at entrance G. Under-6s ride tandem on the luge."], ["group", "Remind the group not to pack sweaty togs in the checked luggage this morning."]]),
  S(3, "09:45", "Adrenaline Forest Queenstown", "activity", "Adrenaline Forest", "Frankton Rd, Queenstown", "03 555 0303", "AF-77812", "High ropes courses. Ground course for the nervous two.", [["guide", "Waivers signed online; check the list at the kiosk. Helen and Lila stay on the ground course."]]),
  S(3, "12:30", "Lunch, Fergburger", "meal_lunch", "Fergburger", "42 Shotover St, Queenstown", "03 555 0402", null, "No booking, pay direct. Expect a queue.", []),
  S(3, "19:00", "Dinner, Botswana Butchery", "meal_dinner", "Botswana Butchery", "17 Marine Pde, Queenstown", "03 555 0405", "BB-3310", "Group dinner, set menu.", [["guide", "Gluten-free for Ava, two vegetarians from the walking club."]]),
  S(3, null, "Overnight, Copthorne Lakefront", "accommodation", "Copthorne Lakefront", "Frankton Rd, Queenstown", "03 555 0202", "CL-9020", "Second night.", []),
  S(4, "07:00", "Breakfast, Vudu Cafe", "meal_breakfast", "Vudu Cafe", "16 Rees St, Queenstown", "03 555 0401", "VC-4411", "Early; bags on the coach by 07:45.", []),
  S(4, "12:00", "Thunder Creek Falls and Haast Pass", "activity", null, "Haast Pass Hwy", null, null, "Short walks and photo stops. Lunch is a picnic from the hotel.", [["driver", "Fuel at Wānaka; nothing reliable until Haast."]]),
  S(4, "19:00", "Dinner, Alice May", "meal_dinner", "Alice May", "Cowan St, Franz Josef", "03 555 0403", "AM-5566", "Group dinner.", [["guide", "Gluten-free for Ava."]]),
  S(4, null, "Overnight, Rainforest Retreat", "accommodation", "Rainforest Retreat", "Cron St, Franz Josef", "03 555 0203", "RR-10921", "Rooming list sent. Trailer can stay hitched in the coach bay.", []),
  S(5, "07:30", "Breakfast, Rainforest Retreat", "meal_breakfast", "Rainforest Retreat", "Cron St, Franz Josef", "03 555 0203", "RR-10921", "Then the glacier valley walk, 1.5 hours return.", []),
  S(5, "12:15", "Lunch, The Landing", "meal_lunch", "The Landing", "Revell St, Hokitika", "03 555 0404", "TL-301", "Group lunch.", []),
  S(5, "18:30", "Dinner, Bealey Hotel", "meal_dinner", "Bealey Hotel", "State Highway 73, Arthur's Pass", "03 555 0204", "BH-2210", "Early dinner, then the last leg to Christchurch.", [["driver", "Last drop-offs: airport hotels first, then the Okafors in Merivale."]]),
];
for (const st of STOPS) {
  const supplier = st.supplierName ? sup(st.supplierName) : null;
  const stop = await must(sb.from("stops").insert({ operator_id: oid, tour_id: tour.id, tour_day_id: dayId(st.n), departure_id: deps[st.n - 1].id, time: st.time, name: st.name, category: st.category, supplier_id: supplier?.id ?? null, address: st.address, phone: st.phone, reference: st.reference, blurb: st.blurb, sequence: 0 }).select().single());
  if (st.notes.length) await must(sb.from("stop_notes").insert(st.notes.map(([audience, body]) => ({ stop_id: stop.id, operator_id: oid, audience, body }))));
}

// ---- transport request: confirmed by Ritchies, with driver details and inclusions ----
await must(sb.from("transport_requests").insert({ operator_id: oid, tour_id: tour.id, date_from: D[0], date_to: D[4], supplier_id: sup("Ritchies").id, vehicle_spec: "18-seat Sprinter with luggage trailer", price: 6800, driver_name: "Sam Kereopa", driver_phone: "021 555 1234", driver_meals_included: true, driver_accommodation_included: true, status: "confirmed", notes: "Sam has done this loop; knows the Bealey coach park.", message_body: "Kia ora Ritchies team, requesting an 18-seat Sprinter with luggage trailer for 5 days, Christchurch to Christchurch via Tekapo, Mount Cook, Queenstown and Franz Josef. Could you confirm availability, the price, the driver's details, and whether the driver's meals and accommodation are included? Ngā mihi, Kea Coach Tours", sent_at: new Date(Date.now() - 86400000 * 9).toISOString(), reply_text: "Confirmed. Driver is Sam Kereopa, 021 555 1234. $6,800 all up, meals and accommodation included.", replied_at: new Date(Date.now() - 86400000 * 8).toISOString() }));

// ---- plans for every day (charter mode) ----
const { data: sess } = await sb.auth.getSession();
const call = (fn, body) => fetch(`${URL}/functions/v1/${fn}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${sess.session.access_token}` }, body: JSON.stringify(body) }).then((r) => r.json());
const plans = [];
for (let i = 0; i < D.length; i++) { const r = await call("plan-day", { operator_id: oid, date: D[i], alerts: i === 1 ? "MetService: strong nor'west forecast for Mount Cook from midday. Glacier Explorers weather call at 08:00." : undefined }); plans.push(r.plan_id); console.log(D[i], r.summary ? `${r.summary.departures} dep · ${r.summary.pax} pax · ${r.summary.messages} msgs · ${r.summary.exceptions} decide` : r); }
// day 1: supplier confirmations sent, two replied; driver briefs drafted
const r1 = await call("supplier-confirm", { operator_id: oid, plan_id: plans[0] }); console.log("supplier-confirm day 1:", r1.sent ?? r1.count ?? JSON.stringify(r1).slice(0, 120));
const { data: confs } = await sb.from("supplier_confirmations").select("id, supplier_name").eq("plan_id", plans[0]);
for (const c of confs ?? []) if (/Bluewater/.test(c.supplier_name)) await sb.from("supplier_confirmations").update({ status: "confirmed", reply_text: "Confirmed, 7 rooms as per the list, ground floor sorted for the single. See you tomorrow.", replied_at: new Date().toISOString() }).eq("id", c.id);
const rb = await call("driver-brief", { operator_id: oid, plan_id: plans[0] }); console.log("driver briefs day 1:", rb.count ?? JSON.stringify(rb).slice(0, 120));
console.log("DEMO READY", EMAIL, PASS, "tour", tour.id);
