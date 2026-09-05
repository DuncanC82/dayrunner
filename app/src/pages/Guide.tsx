import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { supabase, tomorrow } from "../lib/supabase";

/** Read-mostly run sheet for a driver-guide on a phone. */
export default function Guide() {
  const { operator } = useAuth();
  const [date, setDate] = useState(tomorrow()); const [runs, setRuns] = useState<any[]>([]); const [deps, setDeps] = useState<any[]>([]); const [bk, setBk] = useState<any[]>([]);
  useEffect(() => { (async () => { if (!operator) return; const { data: p } = await supabase.from("plans").select("id").eq("operator_id", operator.id).eq("date", date).maybeSingle(); const { data: d } = await supabase.from("departures").select("*").eq("operator_id", operator.id).eq("date", date); setDeps(d ?? []); const { data: b } = await supabase.from("bookings").select("*").eq("operator_id", operator.id).in("departure_id", (d ?? []).map((x) => x.id)); setBk(b ?? []); if (!p) { setRuns([]); return; } const { data: a } = await supabase.from("allocations").select("*").eq("plan_id", p.id); setRuns(a ?? []); })(); }, [operator?.id, date]);
  const dep = (id: string) => deps.find((d) => d.id === id);
  return (
    <div>
      <div className="eyebrow">Run sheet</div><h1>Driver-guides</h1>
      <div className="bar"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} /></div>
      {runs.length === 0 && <p className="muted">No plan for this date yet.</p>}
      {runs.sort((a, b) => String(dep(a.departure_id)?.time).localeCompare(String(dep(b.departure_id)?.time))).map((a) => { const d = dep(a.departure_id); const guests = bk.filter((b) => b.departure_id === a.departure_id); return (
        <section key={a.id} className="panel">
          <h2>{String(d?.time).slice(0, 5)} · {d?.product_name}</h2>
          <p><b>{a.driver_label ?? "no driver"}</b> · {a.vehicle_label ?? "no vehicle"} · {a.pax} pax</p>
          {a.note && <p className="small muted">{a.note}</p>}
          <ol>{(a.pickup_sequence ?? []).map((s: any, i: number) => <li key={i}><b>{s.time}</b> {s.location}: {s.names.join(", ")} ({s.pax})</li>)}</ol>
          <details><summary className="small">Guest list</summary><ul>{guests.map((g) => <li key={g.id}>{g.lead_name} × {g.pax}{g.notes ? ` · ${g.notes}` : ""}{g.phone ? ` · ${g.phone}` : ""}</li>)}</ul></details>
        </section>); })}
    </div>
  );
}
