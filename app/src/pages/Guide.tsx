import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { callFn, supabase, tomorrow } from "../lib/supabase";

/** Read-mostly run sheet for a driver-guide on a phone, plus the coordinator's driver briefs for the evening before. */
export default function Guide() {
  const { operator } = useAuth();
  const [date, setDate] = useState(tomorrow()); const [plan, setPlan] = useState<any>(null); const [runs, setRuns] = useState<any[]>([]); const [deps, setDeps] = useState<any[]>([]); const [bk, setBk] = useState<any[]>([]);
  const [briefs, setBriefs] = useState<any[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null);
  async function load() {
    if (!operator) return;
    const { data: p } = await supabase.from("plans").select("id, status").eq("operator_id", operator.id).eq("date", date).maybeSingle(); setPlan(p);
    const { data: d } = await supabase.from("departures").select("*").eq("operator_id", operator.id).eq("date", date); setDeps(d ?? []);
    const { data: b } = await supabase.from("bookings").select("*").eq("operator_id", operator.id).in("departure_id", (d ?? []).map((x) => x.id)); setBk(b ?? []);
    if (!p) { setRuns([]); setBriefs([]); return; }
    const { data: a } = await supabase.from("allocations").select("*").eq("plan_id", p.id); setRuns(a ?? []);
    const { data: m } = await supabase.from("messages").select("*").eq("plan_id", p.id).is("booking_id", null).like("label", "Driver brief · %").order("label"); setBriefs(m ?? []);
  }
  useEffect(() => { load(); }, [operator?.id, date]);
  async function draftBriefs() { if (!operator || !plan) return; setBusy(true); setErr(null); setInfo(null); try { const r = await callFn("driver-brief", { operator_id: operator.id, plan_id: plan.id }); setInfo(`Drafted ${r.count} briefs. Read them, approve, then send from the Day page.`); await load(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  async function approveAll() { if (!plan) return; await supabase.from("messages").update({ status: "approved" }).eq("plan_id", plan.id).is("booking_id", null).like("label", "Driver brief · %").eq("status", "draft"); setInfo("Briefs approved. Send them with \"Send approved\" on the Day page, or copy into the staff group."); await load(); }
  async function setStatus(id: string, status: string) { await supabase.from("messages").update({ status }).eq("id", id); await load(); }
  const dep = (id: string) => deps.find((d) => d.id === id);
  const drafts = briefs.filter((m) => m.status === "draft").length;
  return (
    <div>
      <div className="eyebrow">Run sheet</div><h1>Driver-guides</h1>
      <div className="bar"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} /></div>
      {runs.length === 0 && <p className="muted">No plan for this date yet.</p>}
      {runs.sort((a, b) => String(dep(a.departure_id)?.time).localeCompare(String(dep(b.departure_id)?.time))).map((a) => { const d = dep(a.departure_id); const guests = bk.filter((b) => b.departure_id === a.departure_id); return (
        <section key={a.id} className="panel">
          <h2>{String(d?.time).slice(0, 5)} · {d?.product_name}</h2>
          <p><b>{a.driver_label ?? "no driver"}</b> · {a.vehicle_label ?? "no vehicle"} · {a.pax} pax</p>
          {!!(a.work_minutes || a.km) && <p className="small">{a.work_minutes ? `Work time ${Math.floor(a.work_minutes / 60)}h${String(a.work_minutes % 60).padStart(2, "0")}` : ""}{a.work_minutes && a.km ? " · " : ""}{a.km ? `${a.km} km` : ""}{(a.breaks ?? []).length ? ` · 30 min break after ${a.breaks.map((b: any) => b.after).join(", ")}` : ""}</p>}
          {a.note && <p className="small muted">{a.note}</p>}
          <ol>{(a.pickup_sequence ?? []).map((s: any, i: number) => <li key={i}><b>{s.time}</b> {s.location}: {s.names.join(", ")} ({s.pax})</li>)}</ol>
          <details><summary className="small">Guest list</summary><ul>{guests.map((g) => <li key={g.id}>{g.lead_name} × {g.pax}{g.notes ? ` · ${g.notes}` : ""}{g.phone ? ` · ${g.phone}` : ""}</li>)}</ul></details>
        </section>); })}

      {plan && <section className="panel">
        <h2>Driver briefs</h2>
        <p className="small muted">The evening-before message to each driver-guide, plus a digest for the staff WhatsApp group. Drafted from the plan; nothing sends until approved.</p>
        <div className="bar">
          <button className="primary" onClick={draftBriefs} disabled={busy || runs.length === 0}>{briefs.length ? "Re-draft driver briefs" : "Draft driver briefs"}</button>
          <button className="sm ghost" onClick={approveAll} disabled={drafts === 0}>Approve all briefs</button>
          {briefs.length > 0 && <span className="muted small">{briefs.length} briefs · {drafts} draft · {briefs.filter((m) => m.status === "approved").length} approved · {briefs.filter((m) => m.status === "sent").length} sent</span>}
        </div>
        {err && <div className="notice err">{err}</div>}{info && <div className="notice">{info}</div>}
        <div className="msgs">{briefs.map((m) => <div key={m.id} className={`msg ${m.status === "sent" ? "sent" : ""}`}>
          <div className="to"><span>{m.label} · {m.channel === "manual" ? "copy to group" : `${m.channel} ${m.recipient}`}</span><span>{m.status.toUpperCase()}{m.error ? " · " + m.error : ""}</span></div>
          <div className="body" style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
          <div className="act">
            {m.status === "draft" && <button className="sm" onClick={() => setStatus(m.id, "approved")}>Approve</button>}
            {m.status === "approved" && <button className="sm ghost" onClick={() => setStatus(m.id, "draft")}>Un-approve</button>}
            <button className="sm ghost" onClick={() => navigator.clipboard.writeText(m.body)}>Copy</button>
          </div>
        </div>)}</div>
      </section>}
    </div>
  );
}
