// Demo workspace: demo+dayrunner@prompt6.com / RunTheDay-2026. Seeds three days and generates plans. Re-runnable.
import { createClient } from "@supabase/supabase-js";
import { loadSample } from "./src/lib/sample.ts";
const URL = "https://tylttoheoazyvbuixrrk.supabase.co", ANON = "sb_publishable_YtPWHlhEtmjBi3dEt-xMIg_MeIitBSS";
const EMAIL = "demo+dayrunner@prompt6.com", PASS = "RunTheDay-2026";
const sb = createClient(URL, ANON);
let { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
if (error) {
  const { execSync } = await import("node:child_process");
  const keys = JSON.parse(execSync("supabase projects api-keys --project-ref tylttoheoazyvbuixrrk -o json").toString());
  const admin = createClient(URL, keys.find((k) => k.name === "service_role").api_key, { auth: { persistSession: false } });
  const r = await admin.auth.admin.createUser({ email: EMAIL, password: PASS, email_confirm: true, user_metadata: { operator_name: "Remarkables Day Tours" } });
  if (r.error) throw r.error;
  ({ data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS })); if (error) throw error;
}
const { data: m } = await sb.from("memberships").select("operator_id").limit(1).single(); const oid = m.operator_id;
// wipe and reseed
for (const t of ["bookings","departures","suppliers","products","staff_availability","vehicles","staff","plans"]) await sb.from(t).delete().eq("operator_id", oid);
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const dates = [day(1), day(2), day(3)];
// loadSample inserts staff/vehicles/products/suppliers each call; only do that once, then departures+bookings for later days via a lighter copy
await loadSample(oid, dates[0], sb);
for (const d of dates.slice(1)) {
  const { data: products } = await sb.from("products").select("id,name").eq("operator_id", oid);
  const pid = (n) => products.find((p) => p.name === n)?.id ?? null;
  const deps = [["Milford Sound Coach & Cruise","06:45"],["Glenorchy Half Day","08:30"],["Arrowtown & Wine Trail","13:00"]];
  const { data: ds } = await sb.from("departures").insert(deps.map(([n, t]) => ({ operator_id: oid, product_id: pid(n), product_name: n, date: d, time: t }))).select();
  const dep = (n) => ds.find((x) => x.product_name === n).id;
  const names = ["Ava Thompson","Noah Williams","Mia Brown","Leo Martin","Isla Wilson","Oscar Taylor","Zoe Anderson","Finn Thomas","Ella Jackson","Hugo White","Ruby Harris","Max Clark"];
  const hotels = ["Novotel Lakeside","Hilton Kawarau","Rees Hotel","Sofitel","Crowne Plaza","Holiday Inn Frankton","Haka House","Queenstown i-SITE"];
  const rows = names.map((nm, i) => ({ operator_id: oid, departure_id: dep(deps[i % 3][0]), external_ref: `BK${d.replace(/-/g, "").slice(4)}${String(i).padStart(2, "0")}`, source: i % 5 === 0 ? "viator" : i % 7 === 0 ? "getyourguide" : "direct", lead_name: nm, pax: 1 + (i % 3), pickup_location: hotels[i % hotels.length], phone: i % 5 === 0 ? null : `+64 21 555 0${String(100 + i)}`, email: i % 5 === 0 ? null : `${nm.split(" ")[0].toLowerCase()}@example.com`, notes: i === 3 ? "vegetarian lunch" : i === 8 ? "one child seat needed (age 5)" : null }));
  await sb.from("bookings").insert(rows);
}
// generate plans
const { data: sess } = await sb.auth.getSession();
for (const d of dates) {
  const r = await fetch(`${URL}/functions/v1/plan-day`, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${sess.session.access_token}` }, body: JSON.stringify({ operator_id: oid, date: d, alerts: d === dates[0] ? "MetService heavy rain warning Fiordland from 04:00. Milford Road avalanche control possible 10:00 to 12:00." : undefined }) });
  console.log(d, r.status, JSON.stringify((await r.json()).summary));
}
console.log("DEMO READY", EMAIL, PASS);
