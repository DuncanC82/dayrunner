import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { callFn, supabase, tomorrow } from "../lib/supabase";

const tag = (s: string) => s === "bad" || s === "failed" ? <span className="tag t-bad">{s === "failed" ? "FAILED" : "DECIDE"}</span> : s === "warn" || s === "hold" || s === "replied" ? <span className="tag t-warn">CHECK</span> : s === "confirmed" ? <span className="tag t-ok">DONE</span> : s === "sent" || s === "sent_manual" ? <span className="tag t-info">{s === "sent" ? "SENT" : "BY HAND"}</span> : <span className="tag t-ok">READY</span>;

export default function Day() {
  const { operator } = useAuth();
  const [date, setDate] = useState(tomorrow());
  const [alerts, setAlerts] = useState("");
  const [plan, setPlan] = useState<any>(null);
  const [allocs, setAllocs] = useState<any[]>([]); const [deps, setDeps] = useState<any[]>([]); const [msgs, setMsgs] = useState<any[]>([]); const [excs, setExcs] = useState<any[]>([]); const [bookings, setBookings] = useState<any[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); const [draft, setDraft] = useState("");

  async function load() {
    if (!operator) return;
    const { data: p } = await supabase.from("plans").select("*").eq("operator_id", operator.id).eq("date", date).maybeSingle();
    setPlan(p); setAlerts(p?.alerts ?? "");
    const { data: d } = await supabase.from("departures").select("*").eq("operator_id", operator.id).eq("date", date).order("time"); setDeps(d ?? []);
    const { data: b } = await supabase.from("bookings").select("*").eq("operator_id", operator.id).in("departure_id", (d ?? []).map((x) => x.id)); setBookings(b ?? []);
    if (!p) { setAllocs([]); setMsgs([]); setExcs([]); return; }
    const [a, m, e] = await Promise.all([
      supabase.from("allocations").select("*").eq("plan_id", p.id), supabase.from("messages").select("*").eq("plan_id", p.id).order("label"),
      supabase.from("exceptions").select("*").eq("plan_id", p.id).order("level"),
    ]);
    setAllocs(a.data ?? []); setMsgs(m.data ?? []); setExcs(e.data ?? []);
  }
  useEffect(() => { load(); }, [operator?.id, date]);

  async function run() {
    if (!operator) return; setBusy(true); setErr(null); setInfo(null);
    try { const r = await callFn("plan-day", { operator_id: operator.id, date, alerts: alerts || undefined }); setInfo(`Planned: ${r.summary.departures} departures, ${r.summary.pax} guests, ${r.summary.messages} messages drafted, ${r.summary.exceptions} decisions needed.`); await load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function setStatus(id: string, status: string, body?: string) { await supabase.from("messages").update(body !== undefined ? { status, body } : { status }).eq("id", id); setEditing(null); await load(); }
  async function approveAll() { await supabase.from("messages").update({ status: "approved" }).eq("plan_id", plan.id).eq("status", "draft"); await supabase.from("plans").update({ status: "approved" }).eq("id", plan.id); await load(); }
  async function send(mode?: string) { if (!operator) return; setBusy(true); setErr(null); try { const r = await callFn("send-messages", { operator_id: operator.id, plan_id: plan.id, mode }); const failed = r.results.filter((x: any) => x.status === "failed").length; setInfo(`Sent ${r.results.length - failed}, failed ${failed}.`); await load(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  async function supStatus(id: string, status: string) { await supabase.from("supplier_confirmations").update({ status }).eq("id", id); await loadSups(); }
  async function supSend(ids?: string[]) {
    if (!operator) return; setBusy(true); setErr(null);
    try {
      const pick = ids ? supRows.filter((s) => ids.includes(s.id)) : supRows.filter((s) => ["pending", "hold", "failed"].includes(s.status));
      const byPlan = new Map<string, string[]>(); for (const s of pick) byPlan.set(s.plan_id, [...(byPlan.get(s.plan_id) ?? []), s.id]);
      let sent = 0, manual = 0, failed = 0;
      for (const [plan_id, confirmation_ids] of byPlan) { const r = await callFn("supplier-confirm", { operator_id: operator.id, plan_id, confirmation_ids }); sent += r.results.filter((x: any) => x.status === "sent").length; manual += r.results.filter((x: any) => x.status === "sent_manual").length; failed += r.results.filter((x: any) => x.status === "failed").length; }
      setInfo(`Supplier confirmations: ${sent} emailed, ${manual} drafted to send by hand, ${failed} failed.`); await loadSups();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const [supOpen, setSupOpen] = useState<string | null>(null);
  // ----- supplier grouping: category, then day (docs/features/charter-mode.md) -----
  const [supRange, setSupRange] = useState<"day" | "tour">("day");
  const [supRows, setSupRows] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const CATS = [{ key: "meals", label: "Meals" }, { key: "activity", label: "Activities" }, { key: "accommodation", label: "Accommodation" }, { key: "transport", label: "Transport" }, { key: "other", label: "Other" }];
  const MEAL: Record<string, string> = { meal_breakfast: "breakfast", meal_lunch: "lunch", meal_dinner: "dinner" };
  const catOf = (s: any) => { const c = s.category ?? "other"; return c.startsWith("meal_") ? "meals" : ["activity", "accommodation", "transport"].includes(c) ? c : "other"; };
  const addDays = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const dayLabel = (iso?: string) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" }) : "";
  async function loadSups() {
    if (!operator) return;
    const { data: sl } = await supabase.from("suppliers").select("id, name, category, email").eq("operator_id", operator.id); setSuppliers(sl ?? []);
    const catBy = new Map((sl ?? []).map((x) => [x.id, x.category]));
    const q = supabase.from("supplier_confirmations").select("*, plans!inner(date)").eq("operator_id", operator.id);
    const { data } = supRange === "tour" ? await q.gte("plans.date", date).lte("plans.date", addDays(date, 6)) : await q.eq("plans.date", date);
    setSupRows((data ?? []).map((s: any) => ({ ...s, plan_date: s.plans?.date, category: s.category ?? catBy.get(s.supplier_id) ?? "other" })));
  }
  useEffect(() => { loadSups(); }, [operator?.id, date, supRange, plan?.id]);
  // ----- charter mode: transport request covering this date -----
  const charter = operator?.settings?.ops_mode === "charter";
  const [treq, setTreq] = useState<any>(null); const [tf, setTf] = useState<any>({}); const [treqOpen, setTreqOpen] = useState(false);
  async function loadTreq() {
    if (!operator || !charter) return;
    const { data } = await supabase.from("transport_requests").select("*").eq("operator_id", operator.id).lte("date_from", date).gte("date_to", date).neq("status", "declined").order("created_at", { ascending: false }).limit(1).maybeSingle();
    setTreq(data ?? null); setTf(data ? { ...data, supplier_id: data.supplier_id ?? "" } : { date_from: date, date_to: date });
  }
  useEffect(() => { loadTreq(); }, [operator?.id, date, charter]);
  async function saveTreq(status?: string): Promise<string | null> {
    if (!operator || !tf.vehicle_spec) return null;
    const row = { operator_id: operator.id, vehicle_spec: tf.vehicle_spec, supplier_id: tf.supplier_id || null, date_from: tf.date_from || date, date_to: tf.date_to || tf.date_from || date, price: tf.price === "" || tf.price == null ? null : Number(tf.price), driver_name: tf.driver_name || null, driver_phone: tf.driver_phone || null, driver_meals_included: !!tf.driver_meals_included, driver_accommodation_included: !!tf.driver_accommodation_included, notes: tf.notes || null, ...(status ? { status } : {}) };
    const r = treq ? await supabase.from("transport_requests").update(row).eq("id", treq.id).select().single() : await supabase.from("transport_requests").insert(row).select().single();
    if (r.error) { setErr(r.error.message); return null; }
    await loadTreq(); setInfo(status === "confirmed" ? "Transport marked confirmed. Re-plan the day to put it on the allocation." : "Transport request saved."); return r.data.id;
  }
  async function requestTransport() {
    if (!operator) return; setBusy(true); setErr(null);
    try { const id = await saveTreq(); if (!id) return; const r = await callFn("transport-request", { operator_id: operator.id, request_id: id }); setInfo(r.sent === "email" ? `Vehicle request emailed to ${r.to}.` : `Vehicle request drafted: ${r.note}`); await loadTreq(); setTreqOpen(true); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function resolve(id: string) { await supabase.from("exceptions").update({ resolved: true }).eq("id", id); await load(); }
  async function noShow(b: any) { if (!operator) return; await supabase.from("incidents").insert({ operator_id: operator.id, departure_id: b.departure_id, booking_id: b.id, kind: "no_show", detail: `${b.lead_name} did not show for pickup` }); setInfo(`${b.lead_name} logged as no-show.`); }

  const pax = bookings.reduce((a, b) => a + (b.pax || 0), 0);
  const approved = msgs.filter((m) => m.status === "approved").length; const drafts = msgs.filter((m) => m.status === "draft").length;
  const depName = (id: string) => { const d = deps.find((x) => x.id === id); return d ? `${String(d.time).slice(0, 5)} ${d.product_name}` : ""; };

  return (
    <div>
      <div className="eyebrow">Day of operations</div>
      <h1>{operator?.name}</h1>
      <div className="bar">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} />
        <span className="muted small">{deps.length} departures · {pax} guests on the manifest</span>
        <button className="primary" onClick={run} disabled={busy || deps.length === 0}>{plan ? "Re-plan the day" : "Plan the day"}</button>
        {plan && <span className="tag t-info">{plan.generated_by} · {plan.status}</span>}
      </div>
      <label>External alerts for the day (weather, road closures, supplier changes)</label>
      <textarea value={alerts} onChange={(e) => setAlerts(e.target.value)} placeholder="MetService heavy rain warning Fiordland from 04:00. Milford Road avalanche control possible 10:00 to 12:00." style={{ minHeight: 56 }} />
      {err && <div className="notice err">{err}</div>}{info && <div className="notice">{info}</div>}
      {deps.length === 0 && <div className="notice">No departures on this date. Import a CSV, sync a connector, or load the sample operator from Setup.</div>}

      {plan && <>
        <div className="summary" style={{ marginTop: 16 }}>
          <div><b>{plan.summary.departures}</b><span>departures</span></div><div><b>{plan.summary.pax}</b><span>guests{plan.summary.km ? ` · ${plan.summary.km} km · ${plan.summary.work_hours}h work` : ""}</span></div><div><b>{msgs.length}</b><span>messages</span></div><div><b>{excs.filter((e) => e.level === "bad" && !e.resolved).length}</b><span>need a decision</span></div>
        </div>
        {plan.summary.narrative && <p className="muted" style={{ marginTop: 10 }}>{plan.summary.narrative}</p>}

        <section><h2>Decide before the day</h2>
          {excs.filter((e) => !e.resolved).length === 0 && <p className="muted">Nothing outstanding.</p>}
          {excs.filter((e) => !e.resolved).map((e) => <div key={e.id} className={`exc ${e.level === "warn" ? "w" : ""}`}><b>{e.title}</b><span className="small">{e.detail}</span><div className="opts">{(e.options ?? []).map((o: string) => <span key={o}>{o}</span>)}<button className="sm ghost" onClick={() => resolve(e.id)}>Resolved</button></div></div>)}
        </section>

        <section><h2>Allocation</h2><div className="wrap"><table>
          <tr><th>Dep</th><th>Product</th><th>Vehicle</th><th>Driver / guide</th><th>Pax</th><th>Pickup run</th><th></th></tr>
          {allocs.sort((a, b) => depName(a.departure_id).localeCompare(depName(b.departure_id))).map((a) => <tr key={a.id}><td className="num">{depName(a.departure_id).slice(0, 5)}</td><td>{depName(a.departure_id).slice(6)}</td><td>{a.vehicle_label ?? <span className="tag t-bad">none</span>}</td><td>{a.driver_label ?? <span className="tag t-bad">none</span>}{a.guide_label && a.guide_label !== a.driver_label && <><br /><small className="muted">{a.guide_label}</small></>}</td><td className="num">{a.pax}{a.work_minutes ? <><br /><small className="muted">{Math.floor(a.work_minutes/60)}h{String(a.work_minutes%60).padStart(2,"0")} · {a.km ?? 0} km</small></> : null}</td><td>{(a.pickup_sequence ?? []).map((s: any) => `${s.time} ${s.location} (${s.pax})`).join(" → ")}{(a.breaks ?? []).length ? <><br /><small className="muted">Breaks after {(a.breaks as any[]).map((b) => b.after).join(", ")}</small></> : null}{a.note && <><br /><small className="muted">{a.note}</small></>}</td><td>{tag(a.status)}</td></tr>)}
        </table></div></section>

        {charter && <section>
          <div className="bar"><h2>Transport</h2><span className="muted small">Charter mode: request a vehicle and driver from a coach company for the whole tour.</span>
            {treq?.status && tag(treq.status === "confirmed" ? "confirmed" : treq.status === "requested" ? "sent" : treq.status === "declined" ? "failed" : "hold")}</div>
          <div className="panel">
            <div className="grid2">
              <div>
                <label>Vehicle requested</label><input value={tf.vehicle_spec ?? ""} onChange={(e) => setTf({ ...tf, vehicle_spec: e.target.value })} placeholder="18-seat Sprinter with trailer" />
                <label>Coach company</label><select value={tf.supplier_id ?? ""} onChange={(e) => setTf({ ...tf, supplier_id: e.target.value })}><option value="">choose (Setup → Suppliers, category transport)</option>{suppliers.filter((x) => x.category === "transport").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                <div className="grid2"><div><label>From</label><input type="date" value={tf.date_from ?? date} onChange={(e) => setTf({ ...tf, date_from: e.target.value })} /></div><div><label>To</label><input type="date" value={tf.date_to ?? date} onChange={(e) => setTf({ ...tf, date_to: e.target.value })} /></div></div>
                <label>Notes for the coach company</label><input value={tf.notes ?? ""} onChange={(e) => setTf({ ...tf, notes: e.target.value })} placeholder="Pickup Queenstown 07:00 day 1, drop Christchurch day 3" />
              </div>
              <div>
                <div className="grid2"><div><label>Price ({treq?.currency ?? "NZD"})</label><input type="number" value={tf.price ?? ""} onChange={(e) => setTf({ ...tf, price: e.target.value })} /></div><div><label>Driver phone</label><input value={tf.driver_phone ?? ""} onChange={(e) => setTf({ ...tf, driver_phone: e.target.value })} /></div></div>
                <label>Driver name</label><input value={tf.driver_name ?? ""} onChange={(e) => setTf({ ...tf, driver_name: e.target.value })} />
                <label><input type="checkbox" checked={!!tf.driver_meals_included} onChange={(e) => setTf({ ...tf, driver_meals_included: e.target.checked })} /> Driver meals included</label>
                <label><input type="checkbox" checked={!!tf.driver_accommodation_included} onChange={(e) => setTf({ ...tf, driver_accommodation_included: e.target.checked })} /> Driver accommodation included</label>
                {treq?.reply_text && <p className="small muted">Reply {treq.replied_at ? new Date(treq.replied_at).toLocaleString("en-NZ", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : ""}: {treq.reply_text}</p>}
              </div>
            </div>
            <div className="bar">
              <button className="sm" onClick={() => saveTreq()} disabled={busy || !tf.vehicle_spec}>Save</button>
              <button className="sm primary" onClick={requestTransport} disabled={busy || !tf.vehicle_spec}>{treq?.sent_at ? "Request again" : "Request"}</button>
              {treq && treq.status !== "confirmed" && <button className="sm ghost" onClick={() => saveTreq("confirmed")} disabled={busy}>Confirmed</button>}
              {treq?.message_body && <button className="sm ghost" onClick={() => setTreqOpen(!treqOpen)}>{treqOpen ? "Hide draft" : "Draft"}</button>}
              {treq?.sent_at && <span className="muted small">sent {new Date(treq.sent_at).toLocaleString("en-NZ", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</span>}
            </div>
            {treqOpen && treq?.message_body && <div className="msg"><div className="body" style={{ whiteSpace: "pre-wrap" }}>{treq.message_body}</div><div className="act"><button className="sm ghost" onClick={() => navigator.clipboard.writeText(treq.message_body)}>Copy</button></div></div>}
          </div>
        </section>}

        <section>
          <div className="bar"><h2>Supplier confirmations</h2><span className="muted small">{supRows.filter((s) => ["pending", "hold"].includes(s.status)).length} pending · {supRows.filter((s) => ["sent", "sent_manual", "replied"].includes(s.status)).length} awaiting reply · {supRows.filter((s) => s.status === "confirmed").length} confirmed</span>
            <span className="seg"><button className={`sm ${supRange === "day" ? "" : "ghost"}`} onClick={() => setSupRange("day")}>This day</button><button className={`sm ${supRange === "tour" ? "" : "ghost"}`} onClick={() => setSupRange("tour")}>Whole tour (7 days)</button></span>
            <button className="sm" onClick={() => supSend()} disabled={busy || supRows.filter((s) => ["pending", "hold", "failed"].includes(s.status)).length === 0}>Send all pending</button>
          </div>
          {CATS.map((cat) => { const rows = supRows.filter((s) => catOf(s) === cat.key).sort((a, b) => String(a.plan_date).localeCompare(String(b.plan_date)) || String(a.supplier_name).localeCompare(String(b.supplier_name))); if (!rows.length) return null; return (
            <div key={cat.key} style={{ marginTop: 10 }}><h3 style={{ margin: "6px 0" }}>{cat.label} <span className="muted small">{rows.filter((s) => s.status === "confirmed").length}/{rows.length} confirmed</span></h3><div className="wrap"><table>
              <tr><th>Day</th><th>Supplier</th><th>Confirm</th><th>By</th><th>Status</th><th></th></tr>
              {rows.map((s) => <>
                <tr key={s.id}><td className="num">{dayLabel(s.plan_date)}</td><td>{s.supplier_name}{cat.key === "meals" && <><br /><small className="muted">{MEAL[s.category] ?? ""}</small></>}</td><td>{s.detail}{s.reply_text && <><br /><small className="muted">Reply: {s.reply_text}</small></>}</td><td className="num">{s.due_label}</td>
                  <td>{tag(s.status)}{s.sent_at && <><br /><small className="muted">sent {new Date(s.sent_at).toLocaleString("en-NZ", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</small></>}{s.replied_at && <><br /><small className="muted">replied {new Date(s.replied_at).toLocaleString("en-NZ", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</small></>}</td>
                  <td>
                    {s.status !== "confirmed" && <button className="sm" onClick={() => supSend([s.id])} disabled={busy}>{s.sent_at ? "Resend" : "Send"}</button>}{" "}
                    {s.message_body && <button className="sm ghost" onClick={() => setSupOpen(supOpen === s.id ? null : s.id)}>{supOpen === s.id ? "Hide draft" : "Draft"}</button>}{" "}
                    {s.status !== "confirmed" && <button className="sm ghost" onClick={() => supStatus(s.id, "confirmed")}>Confirmed</button>}
                  </td></tr>
                {supOpen === s.id && s.message_body && <tr key={s.id + "-draft"}><td colSpan={6}><div className="msg"><div className="body" style={{ whiteSpace: "pre-wrap" }}>{s.message_body}</div><div className="act"><button className="sm ghost" onClick={() => navigator.clipboard.writeText(s.message_body)}>Copy</button></div></div></td></tr>}
              </>)}
            </table></div></div>); })}
          {supRows.length === 0 && <p className="muted">{supRange === "tour" ? "No supplier confirmations in the next 7 days. Plan each day first." : "No suppliers match this day's products. Add suppliers in Setup."}</p>}
        </section>

        <section>
          <div className="bar"><h2>Guest messages</h2><span className="muted small">{drafts} draft · {approved} approved · {msgs.filter((m) => m.status === "sent").length} sent</span>
            <button className="sm ghost" onClick={approveAll} disabled={drafts === 0}>Approve all drafts</button>
            <button className="sm" onClick={() => send()} disabled={busy || approved === 0}>Send approved</button>
            <button className="sm ghost" onClick={() => send("manual")} disabled={busy || approved === 0}>Mark approved as sent by hand</button>
          </div>
          <div className="msgs">{msgs.map((m) => <div key={m.id} className={`msg ${m.status === "held" ? "held" : ""} ${m.status === "sent" ? "sent" : ""}`}>
            <div className="to"><span>{m.label}</span><span>{m.status.toUpperCase()}{m.error ? " · " + m.error : ""}</span></div>
            {editing === m.id ? <><textarea value={draft} onChange={(e) => setDraft(e.target.value)} /><div className="act"><button className="sm" onClick={() => setStatus(m.id, "approved", draft)}>Save and approve</button><button className="sm ghost" onClick={() => setEditing(null)}>Cancel</button></div></> :
              <><div className="body">{m.body}</div><div className="act">
                {m.status === "draft" && <button className="sm" onClick={() => setStatus(m.id, "approved")}>Approve</button>}
                {m.status === "held" && <button className="sm ghost" onClick={() => setStatus(m.id, "draft")}>Release hold</button>}
                {["draft", "held", "approved"].includes(m.status) && <button className="sm ghost" onClick={() => { setEditing(m.id); setDraft(m.body); }}>Edit</button>}
                {m.status === "approved" && <button className="sm ghost" onClick={() => setStatus(m.id, "draft")}>Un-approve</button>}
                <button className="sm ghost" onClick={() => navigator.clipboard.writeText(m.body)}>Copy</button>
              </div></>}
          </div>)}</div>
        </section>

        <section><h2>On the day</h2><p className="muted small">Log no-shows against the booking. They write back to the booking system where the connector supports it.</p><div className="wrap"><table>
          <tr><th>Dep</th><th>Guest</th><th>Pax</th><th>Pickup</th><th>Source</th><th></th></tr>
          {bookings.map((b) => <tr key={b.id}><td className="num">{depName(b.departure_id).slice(0, 5)}</td><td>{b.lead_name}<br /><small className="muted">{b.notes}</small></td><td className="num">{b.pax}</td><td>{b.pickup_location ?? "depot"}</td><td>{b.source}</td><td><button className="sm ghost" onClick={() => noShow(b)}>No-show</button></td></tr>)}
        </table></div></section>
      </>}
    </div>
  );
}
