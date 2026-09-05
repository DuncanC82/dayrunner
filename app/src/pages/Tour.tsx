import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase, tomorrow } from "../lib/supabase";
import { addDays, type StopCategory } from "../lib/itinerary";

// docs/features/tours.md — the whole-tour view: one column per day, stops as itinerary cards,
// notes tagged by audience, and a day-1 arrivals panel instead of the no-show list.

export const CATEGORIES: { v: StopCategory; label: string }[] = [
  { v: "activity", label: "Activity" }, { v: "meal_breakfast", label: "Breakfast" }, { v: "meal_lunch", label: "Lunch" }, { v: "meal_dinner", label: "Dinner" },
  { v: "accommodation", label: "Accommodation" }, { v: "transport", label: "Transport" }, { v: "other", label: "Other" },
];
export const AUDIENCES = ["guide", "group", "driver", "office"] as const;
export type Audience = typeof AUDIENCES[number];
const AUD_STYLE: Record<Audience, React.CSSProperties> = {
  guide: { background: "var(--night)", color: "var(--hivis)" },
  group: { background: "var(--ready-bg)", color: "var(--ready)", border: "1px solid var(--ready)" },
  driver: { background: "var(--check-bg)", color: "var(--check)", border: "1px solid var(--check)" },
  office: { background: "var(--paper)", color: "var(--held)", border: "1px solid var(--rule)" },
};
export const AudienceTag = ({ a }: { a: Audience }) => <span className="tag" style={AUD_STYLE[a]}>{a}</span>;
export const RefTag = ({ r }: { r: string }) => <span className="tag" style={{ background: "#fde8cf", color: "#b4520b", border: "1px solid #e08a3c", letterSpacing: ".04em", textTransform: "none", fontSize: ".74rem" }}>{r}</span>;
const hhmm = (t: string | null) => (t ? String(t).slice(0, 5) : "");
export const sortStops = (a: any, b: any) => (a.time && b.time ? String(a.time).localeCompare(String(b.time)) : a.time ? -1 : b.time ? 1 : 0) || (a.sequence ?? 0) - (b.sequence ?? 0);

// docs/features/group-and-day-sheet.md — group composition, rooming, per-day overview + inclusions.
export const ROOM_TYPES = ["twin", "double", "single", "triple", "family"] as const;
export type RoomType = typeof ROOM_TYPES[number];
export const INCLUSIONS = [["transport", "Transport"], ["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"]] as const;
export type InclusionKey = typeof INCLUSIONS[number][0];
/** "Mon 12 Oct" from an ISO date. */
export const fmtDate = (iso: string | null | undefined) => { if (!iso) return ""; const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); };
/** Plain-language overview for a day: the coordinator's text, else a generated sentence listing the day's stops in order. */
export function dayOverview(d: any, stops: any[]): string {
  if (d?.overview?.trim()) return d.overview.trim();
  const names = [...stops].sort(sortStops).map((s) => s.name);
  if (!names.length) return d?.title ? `${d.title}.` : "Nothing planned yet.";
  return `${d?.title ? d.title + ": " : ""}${names.join(", then ")}.`;
}
export const roomingLine = (r: any) => `${r.count ?? 1} × ${r.room_type}${r.occupants ? ` (${r.occupants})` : ""}${r.notes ? ` · ${r.notes}` : ""}`;
export const groupLine = (t: any) => { const parts = [`${t.adults ?? 0} adult${t.adults === 1 ? "" : "s"}`, `${t.children ?? 0} child${t.children === 1 ? "" : "ren"}`]; if ((t.boys ?? 0) + (t.girls ?? 0) > 0) parts.push(`${t.boys ?? 0} boy${t.boys === 1 ? "" : "s"}, ${t.girls ?? 0} girl${t.girls === 1 ? "" : "s"}`); return parts.join(" · "); };
/** Read-only group block for the day sheet: pax split, rooming lines, group notes. */
export function GroupSummary({ tour, rooming }: { tour: any; rooming: any[] }) {
  const total = (tour.adults ?? 0) + (tour.children ?? 0);
  const rooms = rooming.reduce((n, r) => n + (r.count ?? 1), 0);
  return (
    <div className="msg" style={{ borderTopColor: "var(--ready)" }}>
      <div className="to"><span>Group</span><span>{total || tour.group_pax || 0} pax · {rooms} room{rooms === 1 ? "" : "s"}</span></div>
      <div style={{ fontWeight: 600 }}>{groupLine(tour)}</div>
      {rooming.length > 0 && <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{rooming.map((r) => <li key={r.id}>{roomingLine(r)}</li>)}</ul>}
      {rooming.length === 0 && <div className="muted small">No rooming list yet.</div>}
      {tour.group_notes && <div className="small" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{tour.group_notes}</div>}
    </div>
  );
}

/** One itinerary card. `showNotes` filters the audiences rendered (the guide sheet hides GROUP/OFFICE). */
export function StopCard({ s, notes, showNotes = [...AUDIENCES], onEdit, onAddNote, onDeleteNote }: { s: any; notes: any[]; showNotes?: readonly Audience[]; onEdit?: () => void; onAddNote?: (a: Audience, body: string) => Promise<void>; onDeleteNote?: (id: string) => Promise<void> }) {
  const [adding, setAdding] = useState(false); const [aud, setAud] = useState<Audience>("guide"); const [body, setBody] = useState("");
  const shown = notes.filter((n) => showNotes.includes(n.audience));
  const cat = CATEGORIES.find((c) => c.v === s.category)?.label ?? s.category;
  return (
    <div className="msg" style={{ borderTopColor: s.category === "accommodation" ? "var(--held)" : s.category.startsWith("meal") ? "var(--ready)" : "var(--link)" }}>
      <div className="to"><span>{hhmm(s.time) || "no time"} · {cat}</span>{onEdit && <a href="#" onClick={(e) => { e.preventDefault(); onEdit(); }}>Edit</a>}</div>
      <div style={{ fontWeight: 600, fontSize: "1rem", color: "var(--link)" }}>{s.name}</div>
      {(s.address || s.phone) && <div style={{ color: "var(--ink)" }}>{[s.address, s.phone].filter(Boolean).join(" · ")}</div>}
      {s.reference && <div style={{ margin: "4px 0" }}><RefTag r={s.reference} /></div>}
      {s.blurb && <div style={{ color: "var(--ink-2)", marginTop: 4 }}>{s.blurb}</div>}
      {shown.length > 0 && <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
        {AUDIENCES.filter((a) => showNotes.includes(a)).flatMap((a) => shown.filter((n) => n.audience === a).map((n) => (
          <div key={n.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><AudienceTag a={a} /><span style={{ flex: 1 }}>{n.body}</span>{onDeleteNote && <a href="#" className="small muted" onClick={(e) => { e.preventDefault(); onDeleteNote(n.id); }}>×</a>}</div>
        )))}
      </div>}
      {onAddNote && (adding ? <div className="act" style={{ alignItems: "center" }}>
        <select value={aud} onChange={(e) => setAud(e.target.value as Audience)} style={{ width: "auto" }}>{AUDIENCES.map((a) => <option key={a} value={a}>{a.toUpperCase()}</option>)}</select>
        <input value={body} placeholder="Check in 20 min prior, pick up tickets at entrance G" onChange={(e) => setBody(e.target.value)} style={{ flex: 1, minWidth: 160 }} onKeyDown={async (e) => { if (e.key === "Enter" && body.trim()) { await onAddNote(aud, body.trim()); setBody(""); setAdding(false); } }} />
        <button className="sm" onClick={async () => { if (!body.trim()) return; await onAddNote(aud, body.trim()); setBody(""); setAdding(false); }}>Add</button>
        <button className="sm ghost" onClick={() => setAdding(false)}>Cancel</button>
      </div> : <div className="act"><button className="sm ghost" onClick={() => setAdding(true)}>+ note</button></div>)}
    </div>
  );
}

const EMPTY_STOP = { time: "", name: "", category: "activity" as StopCategory, address: "", phone: "", reference: "", blurb: "" };
function StopForm({ init, onSave, onCancel, onDelete }: { init: typeof EMPTY_STOP; onSave: (v: typeof EMPTY_STOP) => Promise<void>; onCancel: () => void; onDelete?: () => Promise<void> }) {
  const [v, setV] = useState(init); const set = (k: keyof typeof EMPTY_STOP) => (e: any) => setV({ ...v, [k]: e.target.value });
  return (
    <div className="msg" style={{ borderTopColor: "var(--hivis)" }}>
      <div className="bar" style={{ margin: "0 0 6px" }}><input type="time" value={v.time} onChange={set("time")} style={{ width: 120 }} /><select value={v.category} onChange={set("category")} style={{ width: "auto" }}>{CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}</select></div>
      <input placeholder="Stop name, e.g. Skyline Gondola" value={v.name} onChange={set("name")} style={{ marginBottom: 6 }} />
      <input placeholder="Address" value={v.address} onChange={set("address")} style={{ marginBottom: 6 }} />
      <div className="bar" style={{ margin: "0 0 6px" }}><input placeholder="Phone" value={v.phone} onChange={set("phone")} style={{ flex: 1 }} /><input placeholder="Booking ref" value={v.reference} onChange={set("reference")} style={{ flex: 1 }} /></div>
      <textarea placeholder="Blurb about the activity" value={v.blurb} onChange={set("blurb")} rows={2} style={{ minHeight: 50 }} />
      <div className="act"><button className="sm" disabled={!v.name.trim()} onClick={() => onSave(v)}>Save</button><button className="sm ghost" onClick={onCancel}>Cancel</button>{onDelete && <button className="sm ghost danger" style={{ marginLeft: "auto" }} onClick={onDelete}>Delete</button>}</div>
    </div>
  );
}

function TourList() {
  const { operator } = useAuth();
  const [tours, setTours] = useState<any[]>([]); const [dayCounts, setDayCounts] = useState<Record<string, number>>({});
  const [name, setName] = useState(""); const [start, setStart] = useState(tomorrow()); const [end, setEnd] = useState(tomorrow()); const [pax, setPax] = useState(""); const [err, setErr] = useState<string | null>(null);
  async function load() { if (!operator) return; const { data } = await supabase.from("tours").select("*").eq("operator_id", operator.id).order("start_date", { ascending: false }); setTours(data ?? []); const { data: d } = await supabase.from("tour_days").select("tour_id").eq("operator_id", operator.id); const c: Record<string, number> = {}; for (const x of d ?? []) c[x.tour_id] = (c[x.tour_id] ?? 0) + 1; setDayCounts(c); }
  useEffect(() => { load(); }, [operator?.id]);
  async function create() {
    if (!operator || !name.trim()) return; setErr(null);
    try {
      const { data: t, error } = await supabase.from("tours").insert({ operator_id: operator.id, name: name.trim(), start_date: start || null, end_date: end || start || null, group_pax: Number(pax) || null, status: "draft" }).select().single(); if (error) throw error;
      const n = start && end ? Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1) : 1;
      const days = Array.from({ length: n }, (_, i) => ({ tour_id: t.id, operator_id: operator.id, day_number: i + 1, date: start ? addDays(start, i) : null }));
      const { error: de } = await supabase.from("tour_days").insert(days); if (de) throw de;
      setName(""); setPax(""); await load();
    } catch (e: any) { setErr(e.message); }
  }
  return (
    <div>
      <div className="eyebrow">Tours</div><h1>The whole tour</h1>
      <p className="muted">One group, one coach, a run of days. Each day is a column of stops with the address, phone, reference, blurb and who-it's-for notes. Import an itinerary or start one here.</p>
      {err && <div className="notice err">{err}</div>}
      <div className="panel"><div className="bar" style={{ margin: 0 }}>
        <input placeholder="Tour name, e.g. Southern Loop" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 2, minWidth: 200 }} />
        <label style={{ margin: 0 }}>Start</label><input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} style={{ width: 160 }} />
        <label style={{ margin: 0 }}>End</label><input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} style={{ width: 160 }} />
        <label style={{ margin: 0 }}>Pax</label><input type="number" min={1} value={pax} onChange={(e) => setPax(e.target.value)} style={{ width: 80 }} />
        <button className="primary" onClick={create} disabled={!name.trim()}>New tour</button>
      </div></div>
      {tours.length === 0 ? <p className="muted" style={{ marginTop: 16 }}>No tours yet. Paste an itinerary on Import and tick "Create as a tour", or make one above.</p> :
        <div className="wrap" style={{ marginTop: 16 }}><table><thead><tr><th>Tour</th><th>Dates</th><th>Days</th><th>Pax</th><th>Status</th></tr></thead><tbody>
          {tours.map((t) => <tr key={t.id}><td><Link to={`/app/tours/${t.id}`}><b>{t.name}</b></Link></td><td className="num">{t.start_date ?? "—"}{t.end_date && t.end_date !== t.start_date ? ` → ${t.end_date}` : ""}</td><td className="num">{dayCounts[t.id] ?? 0}</td><td className="num">{t.group_pax ?? "—"}</td><td><span className={`tag ${t.status === "confirmed" || t.status === "running" ? "t-ok" : t.status === "cancelled" ? "t-bad" : "t-warn"}`}>{t.status}</span></td></tr>)}
        </tbody></table></div>}
    </div>
  );
}

function TourDetail({ id }: { id: string }) {
  const { operator } = useAuth();
  const [tour, setTour] = useState<any>(null); const [days, setDays] = useState<any[]>([]); const [stops, setStops] = useState<any[]>([]); const [notes, setNotes] = useState<any[]>([]); const [arrivals, setArrivals] = useState<any[]>([]); const [rooming, setRooming] = useState<any[]>([]);
  const [editing, setEditing] = useState<string | null>(null); const [addingDay, setAddingDay] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null); const [editHead, setEditHead] = useState(false);
  async function load() {
    if (!operator) return;
    const { data: t } = await supabase.from("tours").select("*").eq("id", id).maybeSingle(); setTour(t);
    const { data: r } = await supabase.from("rooming").select("*").eq("tour_id", id).order("sequence"); setRooming(r ?? []);
    const { data: d } = await supabase.from("tour_days").select("*").eq("tour_id", id).order("day_number"); setDays(d ?? []);
    const { data: s } = await supabase.from("stops").select("*").eq("tour_id", id); setStops(s ?? []);
    const { data: n } = await supabase.from("stop_notes").select("*").in("stop_id", (s ?? []).map((x) => x.id)).order("created_at"); setNotes(n ?? []);
    const day1 = (d ?? []).find((x) => x.day_number === 1);
    if (day1) { const { data: deps } = await supabase.from("departures").select("id,product_name,time").eq("tour_day_id", day1.id); const ids = (deps ?? []).map((x) => x.id); const { data: b } = ids.length ? await supabase.from("bookings").select("*").in("departure_id", ids) : { data: [] as any[] }; setArrivals((b ?? []).map((x) => ({ ...x, dep: (deps ?? []).find((y) => y.id === x.departure_id) }))); } else setArrivals([]);
  }
  useEffect(() => { load(); }, [operator?.id, id]);
  const run = async (p: PromiseLike<{ error: any }>) => { setErr(null); const { error } = await p; if (error) setErr(error.message); await load(); };
  const stopInit = (s: any) => ({ time: hhmm(s.time), name: s.name ?? "", category: s.category as StopCategory, address: s.address ?? "", phone: s.phone ?? "", reference: s.reference ?? "", blurb: s.blurb ?? "" });
  const row = (v: typeof EMPTY_STOP) => ({ time: v.time || null, name: v.name.trim(), category: v.category, address: v.address || null, phone: v.phone || null, reference: v.reference || null, blurb: v.blurb || null });
  const byDay = useMemo(() => { const m = new Map<string, any[]>(); for (const s of stops) { const a = m.get(s.tour_day_id) ?? []; a.push(s); m.set(s.tour_day_id, a); } for (const a of m.values()) a.sort(sortStops); return m; }, [stops]);
  if (!tour) return <p className="muted">Loading tour…</p>;
  return (
    <div>
      <div className="eyebrow"><Link to="/app/tours">Tours</Link> · whole-tour view</div>
      <h1>{tour.name}</h1>
      <div className="bar">
        <span className="mono small">{tour.start_date ?? "—"}{tour.end_date ? ` → ${tour.end_date}` : ""}</span><span className="muted">·</span><span>{days.length} day{days.length === 1 ? "" : "s"}</span><span className="muted">·</span><span>{tour.group_pax ?? "—"} pax</span>
        <select value={tour.status} onChange={(e) => run(supabase.from("tours").update({ status: e.target.value }).eq("id", id))} style={{ width: "auto" }}>{["draft", "confirmed", "running", "done", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <button className="sm ghost" onClick={() => setEditHead(!editHead)}>{editHead ? "Done" : "Tour notes"}</button>
        <button className="sm ghost" onClick={() => run(supabase.from("tour_days").insert({ tour_id: id, operator_id: operator!.id, day_number: days.length + 1, date: days.length && days[days.length - 1].date ? addDays(days[days.length - 1].date, 1) : tour.start_date }))}>+ day</button>
      </div>
      {editHead && <textarea defaultValue={tour.notes ?? ""} placeholder="Tour-level notes: coach, driver, client contact…" onBlur={(e) => run(supabase.from("tours").update({ notes: e.target.value || null }).eq("id", id))} />}
      {!editHead && tour.notes && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{tour.notes}</p>}
      {err && <div className="notice err">{err}</div>}
      <GroupPanel tour={tour} rooming={rooming} run={run} operatorId={operator!.id} />
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(300px, 1fr))`, gap: 14, marginTop: 14, alignItems: "start" }}>
        {days.map((d) => (
          <div key={d.id} className="panel" style={{ padding: 12 }}>
            <div className="eyebrow">Day {d.day_number}{d.date ? ` · ${d.date}` : ""}</div>
            <input defaultValue={d.title ?? ""} placeholder="Day title, e.g. Queenstown to Franz Josef" onBlur={(e) => { if ((e.target.value || null) !== (d.title ?? null)) run(supabase.from("tour_days").update({ title: e.target.value || null }).eq("id", d.id)); }} style={{ fontFamily: '"Barlow Condensed",sans-serif', fontWeight: 700, fontSize: "1.15rem", textTransform: "uppercase", border: 0, padding: "2px 0", background: "transparent" }} />
            <div className="bar" style={{ margin: "2px 0 6px" }}><input type="date" defaultValue={d.date ?? ""} onBlur={(e) => { if ((e.target.value || null) !== (d.date ?? null)) run(supabase.from("tour_days").update({ date: e.target.value || null }).eq("id", d.id)); }} style={{ width: 150 }} /><input defaultValue={d.overnight_location ?? ""} placeholder="Overnight at…" onBlur={(e) => { if ((e.target.value || null) !== (d.overnight_location ?? null)) run(supabase.from("tour_days").update({ overnight_location: e.target.value || null }).eq("id", d.id)); }} style={{ flex: 1 }} /></div>
            <textarea defaultValue={d.overview ?? ""} rows={2} placeholder={`Overview for the guide, e.g. ${dayOverview({ title: d.title }, byDay.get(d.id) ?? [])}`} onBlur={(e) => { if ((e.target.value || null) !== (d.overview ?? null)) run(supabase.from("tour_days").update({ overview: e.target.value || null }).eq("id", d.id)); }} style={{ minHeight: 48, marginBottom: 6, fontSize: ".84rem" }} />
            <div className="bar small" style={{ margin: "0 0 10px", gap: 12 }}>{INCLUSIONS.map(([k, label]) => <label key={k} style={{ margin: 0, display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={!!d.inclusions?.[k]} onChange={(e) => run(supabase.from("tour_days").update({ inclusions: { ...(d.inclusions ?? {}), [k]: e.target.checked } }).eq("id", d.id))} style={{ width: "auto", margin: 0 }} />{label}</label>)}</div>
            {d.day_number === 1 && <div className="msg" style={{ borderTopColor: "var(--decide)", marginBottom: 10 }}>
              <div className="to"><span>Day 1 arrivals</span><span>{arrivals.length} booking{arrivals.length === 1 ? "" : "s"}</span></div>
              {arrivals.length === 0 ? <div className="muted small">No bookings on day-1 departures yet. Import the group's bookings and link the departure to this tour day, and this lists where each person is and how they get here.</div> :
                <ul style={{ margin: 0, paddingLeft: 18 }}>{arrivals.map((b) => <li key={b.id}><b>{b.lead_name}</b> × {b.pax}{b.pickup_location ? ` · ${b.pickup_location}` : ""}{b.phone ? ` · ${b.phone}` : ""}{b.dep ? ` · ${hhmm(b.dep.time)} ${b.dep.product_name}` : ""}{b.notes ? <span className="muted"> · {b.notes}</span> : null}</li>)}</ul>}
            </div>}
            <div style={{ display: "grid", gap: 8 }}>
              {(byDay.get(d.id) ?? []).map((s) => editing === s.id
                ? <StopForm key={s.id} init={stopInit(s)} onCancel={() => setEditing(null)} onSave={async (v) => { await run(supabase.from("stops").update(row(v)).eq("id", s.id)); setEditing(null); }} onDelete={async () => { await run(supabase.from("stops").delete().eq("id", s.id)); setEditing(null); }} />
                : <StopCard key={s.id} s={s} notes={notes.filter((n) => n.stop_id === s.id)} onEdit={() => setEditing(s.id)} onAddNote={(a, body) => run(supabase.from("stop_notes").insert({ stop_id: s.id, operator_id: operator!.id, audience: a, body }))} onDeleteNote={(nid) => run(supabase.from("stop_notes").delete().eq("id", nid))} />)}
              {addingDay === d.id
                ? <StopForm init={EMPTY_STOP} onCancel={() => setAddingDay(null)} onSave={async (v) => { await run(supabase.from("stops").insert({ ...row(v), operator_id: operator!.id, tour_id: id, tour_day_id: d.id, sequence: (byDay.get(d.id)?.length ?? 0) + 1 })); setAddingDay(null); }} />
                : <button className="sm ghost" onClick={() => setAddingDay(d.id)}>+ stop</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Group panel: adults / children / boys / girls, group notes, and the rooming list ("what kind of combination are we booking for them?"). */
function GroupPanel({ tour, rooming, run, operatorId }: { tour: any; rooming: any[]; run: (p: PromiseLike<{ error: any }>) => Promise<void>; operatorId: string }) {
  const num = (k: "adults" | "children" | "boys" | "girls") => (
    <div><label style={{ margin: "0 0 2px" }}>{k}</label><input type="number" min={0} defaultValue={tour[k] ?? 0} onBlur={(e) => { const v = Math.max(0, Number(e.target.value) || 0); if (v !== (tour[k] ?? 0)) run(supabase.from("tours").update({ [k]: v }).eq("id", tour.id)); }} style={{ width: 84 }} /></div>
  );
  const total = (tour.adults ?? 0) + (tour.children ?? 0); const rooms = rooming.reduce((n, r) => n + (r.count ?? 1), 0);
  const kidsMismatch = (tour.boys ?? 0) + (tour.girls ?? 0) > (tour.children ?? 0);
  const upd = (r: any, patch: any) => run(supabase.from("rooming").update(patch).eq("id", r.id));
  return (
    <section className="panel" style={{ marginTop: 14, padding: 14 }}>
      <div className="to" style={{ display: "flex", justifyContent: "space-between", fontFamily: '"IBM Plex Mono",monospace', fontSize: ".64rem", letterSpacing: ".04em", textTransform: "uppercase", color: "var(--ink-3)" }}><span>Group</span><span>{total} pax{tour.group_pax && total !== tour.group_pax ? ` (tour says ${tour.group_pax})` : ""} · {rooms} room{rooms === 1 ? "" : "s"}</span></div>
      <div className="bar" style={{ margin: "6px 0", alignItems: "flex-end" }}>{num("adults")}{num("children")}{num("boys")}{num("girls")}
        <input defaultValue={tour.group_notes ?? ""} placeholder="Group notes: dietary, mobility, who's the group leader…" onBlur={(e) => { if ((e.target.value || null) !== (tour.group_notes ?? null)) run(supabase.from("tours").update({ group_notes: e.target.value || null }).eq("id", tour.id)); }} style={{ flex: 1, minWidth: 220 }} />
      </div>
      {kidsMismatch && <div className="small" style={{ color: "var(--decide)" }}>Boys + girls is more than children.</div>}
      <div className="eyebrow" style={{ margin: "8px 0 4px" }}>Rooming</div>
      <div style={{ display: "grid", gap: 4 }}>
        {rooming.map((r) => (
          <div key={r.id} className="bar" style={{ margin: 0 }}>
            <input type="number" min={1} defaultValue={r.count ?? 1} onBlur={(e) => { const v = Math.max(1, Number(e.target.value) || 1); if (v !== r.count) upd(r, { count: v }); }} style={{ width: 64 }} />
            <span className="muted">×</span>
            <select defaultValue={r.room_type} onChange={(e) => upd(r, { room_type: e.target.value })} style={{ width: "auto" }}>{ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <input defaultValue={r.occupants ?? ""} placeholder="Occupants: 1 adult + 1 child, or names" onBlur={(e) => { if ((e.target.value || null) !== (r.occupants ?? null)) upd(r, { occupants: e.target.value || null }); }} style={{ flex: 2, minWidth: 160 }} />
            <input defaultValue={r.notes ?? ""} placeholder="Notes: ground floor, cot" onBlur={(e) => { if ((e.target.value || null) !== (r.notes ?? null)) upd(r, { notes: e.target.value || null }); }} style={{ flex: 1, minWidth: 120 }} />
            <a href="#" className="small muted" onClick={(e) => { e.preventDefault(); run(supabase.from("rooming").delete().eq("id", r.id)); }}>×</a>
          </div>
        ))}
        <div><button className="sm ghost" onClick={() => run(supabase.from("rooming").insert({ operator_id: operatorId, tour_id: tour.id, room_type: "twin", count: 1, sequence: rooming.length + 1 }))}>+ room</button></div>
      </div>
    </section>
  );
}

export default function Tour() { const { id } = useParams(); return id ? <TourDetail id={id} /> : <TourList />; }
