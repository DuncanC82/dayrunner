import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { callFn, supabase, tomorrow } from "../lib/supabase";

const tag = (s: string) => s === "bad" || s === "failed" ? <span className="tag t-bad">{s === "failed" ? "FAILED" : "DECIDE"}</span> : s === "warn" || s === "hold" || s === "replied" ? <span className="tag t-warn">CHECK</span> : s === "confirmed" ? <span className="tag t-ok">DONE</span> : s === "sent" || s === "sent_manual" ? <span className="tag t-info">{s === "sent" ? "SENT" : "BY HAND"}</span> : <span className="tag t-ok">READY</span>;

export default function Day() {
  const { operator } = useAuth();
  const [date, setDate] = useState(tomorrow());
  const [alerts, setAlerts] = useState("");
  const [plan, setPlan] = useState<any>(null);
  const [allocs, setAllocs] = useState<any[]>([]); const [deps, setDeps] = useState<any[]>([]); const [msgs, setMsgs] = useState<any[]>([]); const [sups, setSups] = useState<any[]>([]); const [excs, setExcs] = useState<any[]>([]); const [bookings, setBookings] = useState<any[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); const [draft, setDraft] = useState("");

  async function load() {
    if (!operator) return;
    const { data: p } = await supabase.from("plans").select("*").eq("operator_id", operator.id).eq("date", date).maybeSingle();
    setPlan(p); setAlerts(p?.alerts ?? "");
    const { data: d } = await supabase.from("departures").select("*").eq("operator_id", operator.id).eq("date", date).order("time"); setDeps(d ?? []);
    const { data: b } = await supabase.from("bookings").select("*").eq("operator_id", operator.id).in("departure_id", (d ?? []).map((x) => x.id)); setBookings(b ?? []);
    if (!p) { setAllocs([]); setMsgs([]); setSups([]); setExcs([]); return; }
    const [a, m, s, e] = await Promise.all([
      supabase.from("allocations").select("*").eq("plan_id", p.id), supabase.from("messages").select("*").eq("plan_id", p.id).order("label"),
      supabase.from("supplier_confirmations").select("*").eq("plan_id", p.id), supabase.from("exceptions").select("*").eq("plan_id", p.id).order("level"),
    ]);
    setAllocs(a.data ?? []); setMsgs(m.data ?? []); setSups(s.data ?? []); setExcs(e.data ?? []);
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
  async function supStatus(id: string, status: string) { await supabase.from("supplier_confirmations").update({ status }).eq("id", id); await load(); }
  async function supSend(ids?: string[]) { if (!operator || !plan) return; setBusy(true); setErr(null); try { const r = await callFn("supplier-confirm", { operator_id: operator.id, plan_id: plan.id, confirmation_ids: ids }); const sent = r.results.filter((x: any) => x.status === "sent").length; const manual = r.results.filter((x: any) => x.status === "sent_manual").length; const failed = r.results.filter((x: any) => x.status === "failed").length; setInfo(`Supplier confirmations: ${sent} emailed, ${manual} drafted to send by hand, ${failed} failed.`); await load(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  const [supOpen, setSupOpen] = useState<string | null>(null);
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

        <section>
          <div className="bar"><h2>Supplier confirmations</h2><span className="muted small">{sups.filter((s) => ["pending", "hold"].includes(s.status)).length} pending · {sups.filter((s) => ["sent", "sent_manual", "replied"].includes(s.status)).length} awaiting reply · {sups.filter((s) => s.status === "confirmed").length} confirmed</span>
            <button className="sm" onClick={() => supSend()} disabled={busy || sups.filter((s) => ["pending", "hold", "failed"].includes(s.status)).length === 0}>Send all pending</button>
          </div>
          <div className="wrap"><table>
          <tr><th>Supplier</th><th>Confirm</th><th>By</th><th>Status</th><th></th></tr>
          {sups.map((s) => <>
            <tr key={s.id}><td>{s.supplier_name}</td><td>{s.detail}{s.reply_text && <><br /><small className="muted">Reply: {s.reply_text}</small></>}</td><td className="num">{s.due_label}</td>
              <td>{tag(s.status)}{s.sent_at && <><br /><small className="muted">sent {new Date(s.sent_at).toLocaleString("en-NZ", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</small></>}{s.replied_at && <><br /><small className="muted">replied {new Date(s.replied_at).toLocaleString("en-NZ", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</small></>}</td>
              <td>
                {s.status !== "confirmed" && <button className="sm" onClick={() => supSend([s.id])} disabled={busy}>{s.sent_at ? "Resend" : "Send"}</button>}{" "}
                {s.message_body && <button className="sm ghost" onClick={() => setSupOpen(supOpen === s.id ? null : s.id)}>{supOpen === s.id ? "Hide draft" : "Draft"}</button>}{" "}
                {s.status !== "confirmed" && <button className="sm ghost" onClick={() => supStatus(s.id, "confirmed")}>Confirmed</button>}
              </td></tr>
            {supOpen === s.id && s.message_body && <tr key={s.id + "-draft"}><td colSpan={5}><div className="msg"><div className="body" style={{ whiteSpace: "pre-wrap" }}>{s.message_body}</div><div className="act"><button className="sm ghost" onClick={() => navigator.clipboard.writeText(s.message_body)}>Copy</button></div></div></td></tr>}
          </>)}
          {sups.length === 0 && <tr><td colSpan={5} className="muted">No suppliers match tomorrow's products. Add suppliers in Setup.</td></tr>}
        </table></div></section>

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
