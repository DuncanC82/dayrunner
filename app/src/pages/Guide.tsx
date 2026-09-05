import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/auth";
import { callFn, supabase, tomorrow } from "../lib/supabase";
import { GroupSummary, INCLUSIONS, StopCard, dayOverview, fmtDate, sortStops } from "./Tour";

// Day sheet groups (docs/features/group-and-day-sheet.md): Jackie's subcategory order.
const SHEET_GROUPS: { label: string; cats: string[] }[] = [
  { label: "Accommodation", cats: ["accommodation"] },
  { label: "Activities", cats: ["activity"] },
  { label: "Meals", cats: ["meal_breakfast", "meal_lunch", "meal_dinner"] },
  { label: "Transport", cats: ["transport"] },
  { label: "Other", cats: ["other"] },
];

/** Read-mostly run sheet for a driver-guide on a phone, plus the coordinator's driver briefs for the evening before. */
export default function Guide() {
  const { operator } = useAuth();
  const [date, setDate] = useState(tomorrow()); const [plan, setPlan] = useState<any>(null); const [runs, setRuns] = useState<any[]>([]); const [deps, setDeps] = useState<any[]>([]); const [bk, setBk] = useState<any[]>([]);
  const [tours, setTours] = useState<any[]>([]); const [tourId, setTourId] = useState<string>(""); const [tourDays, setTourDays] = useState<any[]>([]); const [tourStops, setTourStops] = useState<any[]>([]); const [stopNotes, setStopNotes] = useState<any[]>([]); const [rooming, setRooming] = useState<any[]>([]);
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
  // Tour day sheet (docs/features/tours.md + group-and-day-sheet.md): whole itinerary, today/tomorrow overviews, group, then stops by subcategory. GUIDE + DRIVER notes only, no guest details.
  useEffect(() => { if (!operator) return; supabase.from("tours").select("*").eq("operator_id", operator.id).neq("status", "cancelled").order("start_date", { ascending: false }).then(({ data }) => setTours(data ?? [])); }, [operator?.id]);
  useEffect(() => { (async () => {
    if (!tourId) { setTourDays([]); setTourStops([]); setStopNotes([]); setRooming([]); return; }
    const [{ data: d }, { data: s }, { data: r }] = await Promise.all([
      supabase.from("tour_days").select("*").eq("tour_id", tourId).order("day_number"),
      supabase.from("stops").select("*").eq("tour_id", tourId),
      supabase.from("rooming").select("*").eq("tour_id", tourId).order("sequence"),
    ]);
    setTourDays(d ?? []); setTourStops(s ?? []); setRooming(r ?? []);
    const today = (d ?? []).find((x) => x.date === date); const ids = (s ?? []).filter((x) => x.tour_day_id === today?.id).map((x) => x.id);
    const { data: n } = ids.length ? await supabase.from("stop_notes").select("*").in("stop_id", ids).in("audience", ["guide", "driver"]).order("created_at") : { data: [] as any[] };
    setStopNotes(n ?? []);
  })(); }, [tourId, date]);
  const tour = tours.find((t) => t.id === tourId);
  const tourDay = tourDays.find((d) => d.date === date) ?? null;
  const nextDay = tourDay ? tourDays.find((d) => d.day_number === tourDay.day_number + 1) ?? null : null;
  const stopsOf = (d: any) => (d ? tourStops.filter((s) => s.tour_day_id === d.id).sort(sortStops) : []);
  const stops = useMemo(() => stopsOf(tourDay), [tourDay?.id, tourStops]);
  const included = (d: any) => INCLUSIONS.filter(([k]) => d?.inclusions?.[k]).map(([, label]) => label);
  async function draftBriefs() { if (!operator || !plan) return; setBusy(true); setErr(null); setInfo(null); try { const r = await callFn("driver-brief", { operator_id: operator.id, plan_id: plan.id }); setInfo(`Drafted ${r.count} briefs. Read them, approve, then send from the Day page.`); await load(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  async function approveAll() { if (!plan) return; await supabase.from("messages").update({ status: "approved" }).eq("plan_id", plan.id).is("booking_id", null).like("label", "Driver brief · %").eq("status", "draft"); setInfo("Briefs approved. Send them with \"Send approved\" on the Day page, or copy into the staff group."); await load(); }
  async function setStatus(id: string, status: string) { await supabase.from("messages").update({ status }).eq("id", id); await load(); }
  const dep = (id: string) => deps.find((d) => d.id === id);
  const drafts = briefs.filter((m) => m.status === "draft").length;
  return (
    <div>
      <div className="eyebrow no-print">Run sheet</div><h1 className="no-print">Driver-guides</h1>
      <div className="bar no-print"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} />
        <select value={tourId} onChange={(e) => { setTourId(e.target.value); const t = tours.find((x) => x.id === e.target.value); if (t?.start_date && (date < t.start_date || (t.end_date && date > t.end_date))) setDate(t.start_date); }} style={{ width: "auto" }}><option value="">Fleet run sheet (day tours)</option>{tours.map((t) => <option key={t.id} value={t.id}>{t.name}{t.start_date ? ` · ${t.start_date}` : ""}</option>)}</select>
        {tour && tourDay && <button className="sm ghost" onClick={() => window.print()}>Print day sheet</button>}</div>
      {tour && <section className="panel daysheet" style={{ marginTop: 0 }}>
        {/* 1. Header strip + whole itinerary */}
        <div className="eyebrow">{tour.name}{tourDay ? ` · Day ${tourDay.day_number} of ${tourDays.length}` : ""}</div>
        <h2 style={{ border: 0, marginBottom: 4 }}>{tourDay ? `${fmtDate(tourDay.date)}${tourDay.title ? ` · ${tourDay.title}` : ""}` : tour.name}</h2>
        {!tourDay && <p className="muted">This tour has no day on {date}. Pick a date between {tour.start_date ?? "?"} and {tour.end_date ?? "?"}.</p>}
        <div className="itin small" style={{ display: "grid", gap: 2, margin: "6px 0 12px" }}>
          {tourDays.map((d) => { const now = d.id === tourDay?.id; return (
            <div key={d.id} className={now ? "itin-now" : ""} style={{ display: "flex", gap: 8, padding: "3px 8px", background: now ? "var(--night)" : "transparent", color: now ? "var(--hivis)" : "var(--ink-2)", fontWeight: now ? 600 : 400, cursor: d.date ? "pointer" : "default" }} onClick={() => d.date && setDate(d.date)}>
              <span className="mono" style={{ minWidth: 118 }}>Day {d.day_number} {fmtDate(d.date)}</span><span>{d.title ?? "—"}</span>{d.overnight_location && <span style={{ opacity: .8 }}>· overnight {d.overnight_location}</span>}
            </div>); })}
        </div>
        {tourDay && <>
          {/* 2. Today / tomorrow overviews + inclusions */}
          <div className="grid2" style={{ gap: 10 }}>
            <div className="msg" style={{ borderTopColor: "var(--hivis)" }}>
              <div className="to"><span>Today · Day {tourDay.day_number}</span><span>{fmtDate(tourDay.date)}</span></div>
              <div style={{ fontSize: ".92rem" }}>{dayOverview(tourDay, stops)}</div>
              {tourDay.overnight_location && <div className="small muted" style={{ marginTop: 4 }}>Overnight: {tourDay.overnight_location}</div>}
              <div className="act">{included(tourDay).length ? included(tourDay).map((l) => <span key={l} className="tag t-ok">{l} included</span>) : <span className="muted small">No inclusions marked.</span>}</div>
            </div>
            <div className="msg" style={{ borderTopColor: "var(--held)" }}>
              <div className="to"><span>Tomorrow{nextDay ? ` · Day ${nextDay.day_number}` : ""}</span><span>{nextDay ? fmtDate(nextDay.date) : ""}</span></div>
              {nextDay ? <>
                <div style={{ fontSize: ".92rem" }}>{dayOverview(nextDay, stopsOf(nextDay))}</div>
                {nextDay.overnight_location && <div className="small muted" style={{ marginTop: 4 }}>Overnight: {nextDay.overnight_location}</div>}
                <div className="act">{included(nextDay).map((l) => <span key={l} className="tag t-ok">{l} included</span>)}</div>
              </> : <div className="muted">Last day of the tour.</div>}
            </div>
          </div>
          {/* 3. Group */}
          <div style={{ marginTop: 10 }}><GroupSummary tour={tour} rooming={rooming} /></div>
          {/* 4. Stops by subcategory */}
          {stops.length === 0 && <p className="muted">No stops on this day yet. Add them on the Tours page.</p>}
          {SHEET_GROUPS.map((g) => { const gs = stops.filter((s) => g.cats.includes(s.category)); if (!gs.length) return null; return (
            <div key={g.label} style={{ marginTop: 14 }}>
              <h3 style={{ textTransform: "uppercase", letterSpacing: ".03em", borderBottom: "2px solid var(--night)", marginBottom: 8 }}>{g.label} <span className="muted" style={{ fontWeight: 500 }}>· {gs.length}</span></h3>
              <div className="msgs">{gs.map((s) => <StopCard key={s.id} s={s} notes={stopNotes.filter((n) => n.stop_id === s.id)} showNotes={["guide", "driver"]} />)}</div>
            </div>); })}
        </>}
      </section>}
      {!tour && runs.length === 0 && <p className="muted">No plan for this date yet.</p>}
      {!tour && runs.sort((a, b) => String(dep(a.departure_id)?.time).localeCompare(String(dep(b.departure_id)?.time))).map((a) => { const d = dep(a.departure_id); const guests = bk.filter((b) => b.departure_id === a.departure_id); return (
        <section key={a.id} className="panel">
          <h2>{String(d?.time).slice(0, 5)} · {d?.product_name}</h2>
          <p><b>{a.driver_label ?? "no driver"}</b> · {a.vehicle_label ?? "no vehicle"} · {a.pax} pax</p>
          {!!(a.work_minutes || a.km) && <p className="small">{a.work_minutes ? `Work time ${Math.floor(a.work_minutes / 60)}h${String(a.work_minutes % 60).padStart(2, "0")}` : ""}{a.work_minutes && a.km ? " · " : ""}{a.km ? `${a.km} km` : ""}{(a.breaks ?? []).length ? ` · 30 min break after ${a.breaks.map((b: any) => b.after).join(", ")}` : ""}</p>}
          {a.note && <p className="small muted">{a.note}</p>}
          <ol>{(a.pickup_sequence ?? []).map((s: any, i: number) => <li key={i}><b>{s.time}</b> {s.location}: {s.names.join(", ")} ({s.pax})</li>)}</ol>
          <details><summary className="small">Guest list</summary><ul>{guests.map((g) => <li key={g.id}>{g.lead_name} × {g.pax}{g.notes ? ` · ${g.notes}` : ""}{g.phone ? ` · ${g.phone}` : ""}</li>)}</ul></details>
        </section>); })}

      {plan && <section className="panel no-print">
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
