import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { supabase, tomorrow } from "../lib/supabase";
import { loadSample } from "../lib/sample";

function Table({ title, rows, cols, onAdd, onDelete, blank }: { title: string; rows: any[]; cols: { key: string; label: string; type?: string; placeholder?: string }[]; onAdd: (r: any) => Promise<void>; onDelete: (id: string) => Promise<void>; blank: any }) {
  const [n, setN] = useState<any>(blank);
  return (
    <section><h2>{title}</h2><div className="wrap"><table>
      <tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}<th></th></tr>
      {rows.map((r) => <tr key={r.id}>{cols.map((c) => <td key={c.key}>{Array.isArray(r[c.key]) ? r[c.key].join(", ") : String(r[c.key] ?? "")}</td>)}<td><button className="sm ghost" onClick={() => onDelete(r.id)}>Remove</button></td></tr>)}
      <tr>{cols.map((c) => <td key={c.key}><input type={c.type ?? "text"} placeholder={c.placeholder ?? c.label} value={n[c.key] ?? ""} onChange={(e) => setN({ ...n, [c.key]: e.target.value })} /></td>)}<td><button className="sm" onClick={async () => { await onAdd(n); setN(blank); }}>Add</button></td></tr>
    </table></div></section>
  );
}
const list = (s: string) => String(s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export default function Setup() {
  const { operator, refresh } = useAuth();
  const [staff, setStaff] = useState<any[]>([]); const [vehicles, setVehicles] = useState<any[]>([]); const [products, setProducts] = useState<any[]>([]); const [suppliers, setSuppliers] = useState<any[]>([]); const [avail, setAvail] = useState<any[]>([]);
  const [name, setName] = useState(""); const [voice, setVoice] = useState(""); const [opsMode, setOpsMode] = useState("fleet"); const [stops, setStops] = useState(""); const [info, setInfo] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [avDate, setAvDate] = useState(tomorrow()); const [av, setAv] = useState<any>({});
  const oid = operator?.id;
  async function load() { if (!oid) return; const [s, v, p, su, a] = await Promise.all([supabase.from("staff").select("*").eq("operator_id", oid).order("name"), supabase.from("vehicles").select("*").eq("operator_id", oid).order("name"), supabase.from("products").select("*").eq("operator_id", oid).order("name"), supabase.from("suppliers").select("*").eq("operator_id", oid).order("name"), supabase.from("staff_availability").select("*, staff(name)").eq("operator_id", oid).order("date")]); setStaff(s.data ?? []); setVehicles(v.data ?? []); setProducts(p.data ?? []); setSuppliers(su.data ?? []); setAvail(a.data ?? []); }
  useEffect(() => { load(); if (operator) { setName(operator.name); setVoice(operator.voice); setStops((operator.stop_order ?? []).join(", ")); setOpsMode(operator.settings?.ops_mode === "charter" ? "charter" : "fleet"); } }, [oid]);
  const del = (t: string) => async (id: string) => { await supabase.from(t).delete().eq("id", id); await load(); };
  async function saveOp() { await supabase.from("operators").update({ name, voice, stop_order: list(stops), settings: { ...(operator?.settings ?? {}), ops_mode: opsMode } }).eq("id", oid); await refresh(); setInfo("Saved."); }
  async function sample() { if (!oid) return; setBusy(true); await loadSample(oid, tomorrow()); await refresh(); await load(); setBusy(false); setInfo("Sample operator loaded for tomorrow. Go to Day and press Plan the day."); }

  return (
    <div>
      <div className="eyebrow">Setup</div><h1>Your operation</h1>
      {info && <div className="notice">{info}</div>}
      <div className="panel" style={{ marginTop: 12 }}>
        <div className="grid2">
          <div><label>Operator name</label><input value={name} onChange={(e) => setName(e.target.value)} />
            <label>Pickup stop order (the route that avoids doubling back)</label><input value={stops} onChange={(e) => setStops(e.target.value)} placeholder="Holiday Inn Frankton, Hilton Kawarau, Rees Hotel, Sofitel, Crowne Plaza, Novotel" /></div>
          <div><label>Message voice</label><textarea value={voice} onChange={(e) => setVoice(e.target.value)} />
            <label>Operating mode</label><select value={opsMode} onChange={(e) => setOpsMode(e.target.value)}><option value="fleet">Fleet: allocate our own vehicles and drivers</option><option value="charter">Charter: request a vehicle and driver from a coach company</option></select></div>
        </div>
        <div className="bar"><button onClick={saveOp}>Save</button>{staff.length === 0 && <button className="ghost" onClick={sample} disabled={busy}>Load the sample operator (Remarkables Day Tours)</button>}</div>
      </div>

      <Table title="Driver-guides" rows={staff} blank={{ licence_class: 1, max_hours: 10, p_endorsement: true }} cols={[{ key: "name", label: "Name" }, { key: "phone", label: "Phone" }, { key: "licence_class", label: "Licence class", type: "number" }, { key: "max_hours", label: "Max hours (policy)", type: "number" }, { key: "prior_work_minutes_today", label: "Hours already worked (min)", type: "number", placeholder: "0" }, { key: "skills", label: "Skills (comma)", placeholder: "milford, wine" }, { key: "notes", label: "Notes" }]}
        onAdd={async (n) => { await supabase.from("staff").insert({ operator_id: oid, name: n.name, phone: n.phone || null, licence_class: Number(n.licence_class || 1), max_hours: Number(n.max_hours || 10), prior_work_minutes_today: Number(n.prior_work_minutes_today || 0), skills: list(n.skills), notes: n.notes || null }); await load(); }} onDelete={del("staff")} />
      <p className="muted small">Work time follows the Land Transport Rule: Work Time and Logbooks 2007 (30 min break after 5.5h, 13h day, 70h between 24h breaks). "Hours already worked" covers a shift before the plan starts, e.g. an airport run at 05:00. Add a rule <code>worktime_regime = none</code> to switch the legal checks off for operators outside logbook scope.</p>

      <section><h2>Availability exceptions</h2><p className="muted small">Only enter days that differ from "available all day".</p>
        <div className="wrap"><table><tr><th>Date</th><th>Who</th><th>From</th><th>To</th><th>Unavailable</th><th>Note</th><th></th></tr>
          {avail.map((a) => <tr key={a.id}><td>{a.date}</td><td>{a.staff?.name}</td><td>{a.available_from ?? ""}</td><td>{a.available_to ?? ""}</td><td>{a.unavailable ? "yes" : ""}</td><td>{a.note}</td><td><button className="sm ghost" onClick={del("staff_availability").bind(null, a.id)}>Remove</button></td></tr>)}
          <tr><td><input type="date" value={avDate} onChange={(e) => setAvDate(e.target.value)} /></td><td><select value={av.staff_id ?? ""} onChange={(e) => setAv({ ...av, staff_id: e.target.value })}><option value="">choose</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td><td><input type="time" value={av.available_from ?? ""} onChange={(e) => setAv({ ...av, available_from: e.target.value })} /></td><td><input type="time" value={av.available_to ?? ""} onChange={(e) => setAv({ ...av, available_to: e.target.value })} /></td><td><input type="checkbox" checked={!!av.unavailable} onChange={(e) => setAv({ ...av, unavailable: e.target.checked })} /></td><td><input value={av.note ?? ""} onChange={(e) => setAv({ ...av, note: e.target.value })} /></td><td><button className="sm" onClick={async () => { if (!av.staff_id) return; await supabase.from("staff_availability").upsert({ operator_id: oid, staff_id: av.staff_id, date: avDate, available_from: av.available_from || null, available_to: av.available_to || null, unavailable: !!av.unavailable, note: av.note || null }, { onConflict: "staff_id,date" }); setAv({}); await load(); }}>Add</button></td></tr>
        </table></div></section>

      <Table title="Fleet" rows={vehicles} blank={{ seats: 12, licence_required: 1, status: "ok" }} cols={[{ key: "name", label: "Vehicle" }, { key: "seats", label: "Seats", type: "number" }, { key: "licence_required", label: "Licence needed", type: "number" }, { key: "status", label: "Status (ok/warning/out)" }, { key: "features", label: "Features (comma)", placeholder: "child seat anchor, wheelchair" }, { key: "notes", label: "Notes" }]}
        onAdd={async (n) => { await supabase.from("vehicles").insert({ operator_id: oid, name: n.name, seats: Number(n.seats || 12), licence_required: Number(n.licence_required || 1), status: ["ok", "warning", "out"].includes(n.status) ? n.status : "ok", features: list(n.features), notes: n.notes || null }); await load(); }} onDelete={del("vehicles")} />

      <Table title="Products" rows={products} blank={{ duration_minutes: 240, pickup_lead_minutes: 25 }} cols={[{ key: "name", label: "Name (exactly as the booking system sends it)" }, { key: "duration_minutes", label: "Duration (min)", type: "number" }, { key: "skills_required", label: "Skills needed (comma)" }, { key: "pickup_lead_minutes", label: "Pickup lead (min)", type: "number" }, { key: "route_km", label: "Route km (return)", type: "number", placeholder: "e.g. 580" }]}
        onAdd={async (n) => { await supabase.from("products").insert({ operator_id: oid, name: n.name, duration_minutes: Number(n.duration_minutes || 240), skills_required: list(n.skills_required), pickup_lead_minutes: Number(n.pickup_lead_minutes || 25), route_km: n.route_km ? Number(n.route_km) : null }); await load(); }} onDelete={del("products")} />

      <Table title="Suppliers" rows={suppliers} blank={{ channel: "email", category: "activity", detail_template: "Numbers for {date}: {pax} pax", confirm_by: "17:00 day before" }} cols={[{ key: "name", label: "Supplier" }, { key: "category", label: "Category", placeholder: "activity | meal_breakfast | meal_lunch | meal_dinner | transport | accommodation" }, { key: "email", label: "Email (for reconfirmations)", type: "email" }, { key: "contact", label: "Contact" }, { key: "product_names", label: "Products (comma, partial ok)", placeholder: "Milford" }, { key: "detail_template", label: "What to confirm ({date} {pax} {product} {time})" }, { key: "confirm_by", label: "Confirm by" }]}
        onAdd={async (n) => { const cats = ["activity", "meal_breakfast", "meal_lunch", "meal_dinner", "transport", "accommodation", "other"]; const cat = String(n.category ?? "").trim().toLowerCase().replace(/\s+/g, "_"); await supabase.from("suppliers").insert({ operator_id: oid, name: n.name, category: cats.includes(cat) ? cat : "activity", email: n.email?.trim() || null, contact: n.contact || null, product_names: list(n.product_names), detail_template: n.detail_template || "Numbers for {date}: {pax} pax", confirm_by: n.confirm_by || "17:00 day before" }); await load(); }} onDelete={del("suppliers")} />
    </div>
  );
}
