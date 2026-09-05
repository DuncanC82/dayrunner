import { supabase as defaultClient } from "./supabase.ts";
const supabase = defaultClient;

/** Loads a realistic Queenstown sample operator into the workspace so a new account demos in one click. */
export async function loadSample(operatorId: string, date: string, client: typeof supabase = supabase) {
  const supabase = client;
  await supabase.from("operators").update({ name: "Remarkables Day Tours", stop_order: ["Holiday Inn Frankton", "Hilton Kawarau", "Rees Hotel", "Sofitel", "Crowne Plaza", "Novotel Lakeside", "Haka House", "Queenstown i-SITE"] }).eq("id", operatorId);
  const { data: staff } = await supabase.from("staff").insert([
    { operator_id: operatorId, name: "Tane", licence_class: 2, max_hours: 12, skills: ["milford", "glenorchy", "wine"], notes: "Best Milford guide. 4 Milford days this week already." },
    { operator_id: operatorId, name: "Jess", licence_class: 1, max_hours: 10, skills: ["milford", "glenorchy"], notes: "12-seat and under only." },
    { operator_id: operatorId, name: "Moana", licence_class: 2, max_hours: 12, skills: ["wine", "glenorchy", "milford"], notes: "" },
    { operator_id: operatorId, name: "Rob", licence_class: 1, max_hours: 8, skills: ["wine"], notes: "New. Has not guided Glenorchy solo yet." },
  ]).select();
  const moana = staff?.find((s) => s.name === "Moana"); const rob = staff?.find((s) => s.name === "Rob");
  if (moana) await supabase.from("staff_availability").insert({ operator_id: operatorId, staff_id: moana.id, date, available_from: "12:00", note: "Dentist in the morning" });
  if (rob) await supabase.from("staff_availability").insert({ operator_id: operatorId, staff_id: rob.id, date, available_to: "15:00" });
  await supabase.from("vehicles").insert([
    { operator_id: operatorId, name: "Sprinter A", seats: 12, licence_required: 1, status: "ok", features: ["child seat anchor"] },
    { operator_id: operatorId, name: "Sprinter B", seats: 12, licence_required: 1, status: "ok", features: [] },
    { operator_id: operatorId, name: "Rosa coach", seats: 20, licence_required: 2, status: "warning", features: [], notes: "Engine warning light Friday. Mechanic booked Monday 08:00." },
    { operator_id: operatorId, name: "Highlander", seats: 7, licence_required: 1, status: "ok", features: ["wheelchair"] },
  ]);
  const { data: products } = await supabase.from("products").insert([
    { operator_id: operatorId, name: "Milford Sound Coach & Cruise", duration_minutes: 780, skills_required: ["milford"], pickup_lead_minutes: 25, route_km: 580 },
    { operator_id: operatorId, name: "Glenorchy Half Day", duration_minutes: 255, skills_required: ["glenorchy"], pickup_lead_minutes: 25, route_km: 95 },
    { operator_id: operatorId, name: "Arrowtown & Wine Trail", duration_minutes: 300, skills_required: ["wine"], pickup_lead_minutes: 20, route_km: 60 },
  ]).select();
  await supabase.from("suppliers").insert([
    { operator_id: operatorId, name: "Milford Sound Lodge cafe", channel: "email", contact: "cafe@example.co.nz", email: "cafe@example.co.nz", category: "meal_lunch", product_names: ["Milford"], detail_template: "Lunch numbers for {date}: {pax} pax", confirm_by: "17:00 day before" },
    { operator_id: operatorId, name: "Southern Discoveries", channel: "email", contact: "manifests@example.co.nz", email: "manifests@example.co.nz", category: "activity", product_names: ["Milford"], detail_template: "12:30 cruise manifest for {date}: {pax} pax, names attached", confirm_by: "19:00 day before" },
    { operator_id: operatorId, name: "Mrs Woolly's General Store", channel: "phone", contact: "03 000 0000", product_names: ["Glenorchy"], detail_template: "Morning tea for {pax} at ~09:30 on {date}", confirm_by: "08:00 on the day" },
    { operator_id: operatorId, name: "Gibbston Valley + Kinross", channel: "email", contact: "cellar@example.co.nz", email: "cellar@example.co.nz", category: "activity", product_names: ["Wine"], detail_template: "Tasting for {pax} at 14:30 and 15:45 on {date}", confirm_by: "11:00 on the day" },
  ]);
  const pid = (n: string) => products?.find((p) => p.name === n)?.id ?? null;
  const deps = [
    { name: "Milford Sound Coach & Cruise", time: "06:45" }, { name: "Glenorchy Half Day", time: "08:30" }, { name: "Arrowtown & Wine Trail", time: "13:00" }, { name: "Glenorchy Half Day", time: "13:30" },
  ];
  const { data: departures } = await supabase.from("departures").insert(deps.map((d) => ({ operator_id: operatorId, product_id: pid(d.name), product_name: d.name, date, time: d.time }))).select();
  const dep = (name: string, time: string) => departures?.find((d) => d.product_name === name && String(d.time).startsWith(time))?.id;
  const M = dep("Milford Sound Coach & Cruise", "06:45"), G1 = dep("Glenorchy Half Day", "08:30"), W = dep("Arrowtown & Wine Trail", "13:00"), G2 = dep("Glenorchy Half Day", "13:30");
  const rows = [
    [M, "BK101", "direct", "Hannah Ritter", 2, "Novotel Lakeside", "+49 171 555 0142", "hannah@example.com", ""],
    [M, "BK102", "direct", "The Okafor family", 4, "Holiday Inn Frankton", "+44 7700 900321", null, "one child seat needed (age 4)"],
    [M, "BK103", "viator", "Mei Lin Chen", 2, "Crowne Plaza", null, null, "phone withheld by OTA"],
    [M, "BK104", "direct", "Daniel Perez", 1, "Sofitel", "+1 415 555 0177", null, "vegetarian lunch"],
    [M, "BK105", "getyourguide", "Sarah and Tom Whitcombe", 2, "Rees Hotel", null, "abc123@reply.getyourguide.com", ""],
    [M, "BK106", "direct", "Priya Nair", 3, "Hilton Kawarau", "+91 98 5550 1123", null, ""],
    [M, "BK107", "direct", "Lars Eriksen", 2, "Novotel Lakeside", "+47 900 55 012", null, "booked 22:40 last night"],
    [G1, "BK108", "direct", "Aroha Wilson", 2, "Queenstown i-SITE", "+64 21 555 0190", null, ""],
    [G1, "BK109", "direct", "Ben Cooper", 1, "Haka House", "+64 27 555 0044", null, ""],
    [G1, "BK110", "direct", "Yuki Tanaka", 2, "Hilton Kawarau", "+81 90 5550 1188", null, ""],
    [G1, "BK111", "viator", "Grace O'Neill", 2, "Sofitel", null, null, "phone withheld by OTA"],
    [G2, "BK112", "direct", "Marco Bianchi", 2, "Crowne Plaza", "+39 333 555 0101", null, ""],
    [G2, "BK113", "direct", "Olivia Park", 3, "Novotel Lakeside", "+82 10 5550 1144", null, ""],
    [G2, "BK114", "direct", "James Huang", 1, "Rees Hotel", "+1 646 555 0160", null, "uses a folding wheelchair"],
    [W, "BK115", "direct", "Emma and Jack Reid", 2, "Queenstown i-SITE", "+64 22 555 0156", null, ""],
    [W, "BK116", "getyourguide", "Sofia Alvarez", 1, "Sofitel", null, "xyz@reply.getyourguide.com", ""],
    [W, "BK117", "direct", "Noah Fischer", 2, "Holiday Inn Frankton", "+49 160 555 0133", null, ""],
    [W, "BK118", "direct", "Charlotte Dubois", 2, "Hilton Kawarau", "+33 6 55 50 11 22", null, ""],
    [W, "BK119", "direct", "Liam Murphy", 2, "Haka House", "+64 21 555 0178", null, "no alcohol please"],
  ];
  // A small two-day tour so the Tours page and the tour run sheet have something to show.
  const t0 = new Date(date); t0.setDate(t0.getDate() + 7); const td = (n: number) => { const x = new Date(t0); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const { data: tour } = await supabase.from("tours").insert({ operator_id: operatorId, name: "Southern Loop · Whitcombe group", start_date: td(0), end_date: td(1), group_pax: 12, status: "confirmed", adults: 8, children: 4, boys: 2, girls: 2, group_notes: "Two families plus four friends. One gluten-free child.", notes: "Uses Sprinter A with the trailer." }).select().single();
  if (tour) {
    await supabase.from("rooming").insert([{ operator_id: operatorId, tour_id: tour.id, room_type: "family", occupants: "2 adults + 2 children", count: 2, sequence: 1 }, { operator_id: operatorId, tour_id: tour.id, room_type: "twin", occupants: "Friends", count: 2, sequence: 2 }]);
    const { data: tdays } = await supabase.from("tour_days").insert([
      { tour_id: tour.id, operator_id: operatorId, date: td(0), day_number: 1, title: "Queenstown to Franz Josef", overnight_location: "Rainforest Retreat", inclusions: { transport: true, breakfast: true, dinner: true }, overview: "Skyline Gondola first thing, then over Haast Pass to the West Coast. Dinner at Alice May, overnight Rainforest Retreat." },
      { tour_id: tour.id, operator_id: operatorId, date: td(1), day_number: 2, title: "Franz Josef to Christchurch", overnight_location: "Home", inclusions: { transport: true, breakfast: true, lunch: true }, overview: "Glacier Explorers at 14:00, weather call at 08:00, then Arthur's Pass to Christchurch." },
    ]).select();
    const dId = (n: number) => tdays?.find((d) => d.day_number === n)?.id;
    const st = [
      [1, "08:30", "Skyline Gondola", "activity", "Brecon St, Queenstown", "03 555 0302", "SG-2231", "Gondola to Bob's Peak plus luge.", [["guide", "Check in 20 min prior, pick up tickets at entrance G"], ["group", "Don't pack the sweaty togs in the checked luggage this morning"]]],
      [1, "19:00", "Dinner, Alice May", "meal_dinner", "Cowan St, Franz Josef", "03 555 0403", "AM-5566", "Group dinner.", [["guide", "Gluten-free meal pre-ordered"]]],
      [1, null, "Overnight, Rainforest Retreat", "accommodation", "Cron St, Franz Josef", "03 555 0203", "RR-10921", "Rooming list sent.", []],
      [2, "14:00", "Glacier Explorers", "activity", "Hermitage Hotel, Mount Cook", "03 555 0301", "GE-5567", "Boat among the icebergs.", [["guide", "Weather call by 08:00"], ["driver", "Coach park is behind the terminal, not the front"]]],
    ] as const;
    for (const [n, time, name, category, address, phone, reference, blurb, notes] of st) {
      const { data: stop } = await supabase.from("stops").insert({ operator_id: operatorId, tour_id: tour.id, tour_day_id: dId(n), time, name, category, address, phone, reference, blurb }).select().single();
      if (stop && notes.length) await supabase.from("stop_notes").insert(notes.map(([audience, body]) => ({ stop_id: stop.id, operator_id: operatorId, audience, body })));
    }
  }
  await supabase.from("bookings").insert(rows.map(([departure_id, external_ref, source, lead_name, pax, pickup_location, phone, email, notes]) => ({ operator_id: operatorId, departure_id, external_ref, source, lead_name, pax, pickup_location, phone, email, notes: notes || null })));
}
