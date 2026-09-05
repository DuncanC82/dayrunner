import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { callFn, fnUrl, supabase, tomorrow } from "../lib/supabase";

const KINDS = [
  { kind: "rezdy", title: "Rezdy", fn: "rezdy-sync", help: "Supplier API key from Integrations → Rezdy API (Expansion plan). Register a webhook in Rezdy pointing at the URL below for NEW_ORDER, UPDATED_ORDER and CANCELLED_ORDER.", fields: [{ key: "env", label: "Environment (production or staging)" }] },
  { kind: "fareharbor", title: "FareHarbor", fn: "fareharbor-webhook", help: "Ask support@fareharbor.com to register the URL below as your bookings webhook. Pulling availabilities needs Software Partner app and user keys.", fields: [{ key: "shortname", label: "Company shortname" }, { key: "app_key", label: "App key (partner)" }, { key: "env", label: "Environment (production or demo)" }] },
  { kind: "rcm", title: "Rental Car Manager", fn: "rcm-sync", help: "Point an RCM Automation webhook at the URL below for new and changed reservations. For pulls, enter the API base, reservations path and field map from your sandbox.", fields: [{ key: "api_base", label: "API base, e.g. https://apis.rentalcarmanager.com/booking/v3.x" }, { key: "reservations_path", label: "Reservations path" }, { key: "account_id", label: "Account id" }, { key: "label", label: "Departure label (Handover / Return)" }] },
];

export default function Connectors() {
  const { operator } = useAuth();
  const [conns, setConns] = useState<any[]>([]); const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({}); const [messaging, setMessaging] = useState<any>({});
  const [inbound, setInbound] = useState<any[]>([]);
  const oid = operator?.id;
  async function load() {
    if (!oid) return;
    const { data } = await supabase.from("connectors_public").select("*").eq("operator_id", oid); setConns(data ?? []);
    const { data: op } = await supabase.from("operators").select("settings").eq("id", oid).single(); setMessaging(op?.settings?.messaging ?? {});
    const { data: ib } = await supabase.from("inbound_emails").select("id, from_email, subject, received_at, matched_to, matched_id").eq("operator_id", oid).order("received_at", { ascending: false }).limit(10); setInbound(ib ?? []);
  }
  useEffect(() => { load(); }, [oid]);
  useEffect(() => {
    const u = new URL(window.location.href); const g = u.searchParams.get("gmail"); const ge = u.searchParams.get("gmail_error");
    if (g === "connected") setMsg(`Gmail connected as ${u.searchParams.get("gmail_email") ?? "your Google account"}.`);
    if (ge) setErr(`Google connection failed: ${ge}`);
    if (g || ge) { for (const k of ["gmail", "gmail_error", "gmail_email"]) u.searchParams.delete(k); window.history.replaceState({}, "", u.toString()); }
  }, []);
  async function connectGmail() {
    setBusy(true); setErr(null);
    try { const u = new URL(window.location.href); u.hash = ""; const r = await callFn("gmail-auth", { operator_id: oid, return_to: u.toString() }); window.location.href = r.url; }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }
  async function pollGmail() { setBusy(true); setErr(null); try { const r = await callFn("gmail-poll", { operator_id: oid }); setMsg(`Inbox checked: ${r.fetched} recent, ${r.new} new, ${r.matched} matched, ${r.none} unmatched${r.errors?.length ? `; errors: ${r.errors.join("; ")}` : ""}.`); await load(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  async function disconnectGmail() { const c = conns.find((x) => x.kind === "gmail"); if (!c || !confirm("Disconnect Gmail? DayRunner will fall back to Resend or manual sending.")) return; await supabase.from("connectors").delete().eq("id", c.id); setMsg("Gmail disconnected."); await load(); }

  async function save(kind: string) {
    setErr(null); const f = form[kind] ?? {}; const existing = conns.find((c) => c.kind === kind);
    const config: any = {}; for (const k of KINDS.find((x) => x.kind === kind)!.fields) if (f[k.key]) config[k.key] = f[k.key];
    const row: any = { operator_id: oid, kind, config: { ...(existing?.config ?? {}), ...config }, status: "configured" };
    if (f.secret) row.secret = f.secret;
    const { error } = existing ? await supabase.from("connectors").update(row).eq("id", existing.id) : await supabase.from("connectors").insert(row);
    if (error) setErr(error.message); else { setMsg(`${kind} saved.`); await load(); }
  }
  async function sync(kind: string, fn: string) { setBusy(true); setErr(null); try { const r = await callFn(fn, { operator_id: oid, date: tomorrow() }); setMsg(`${kind}: ${JSON.stringify(r)}`); await load(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  async function saveMessaging() { const { data: op } = await supabase.from("operators").select("settings").eq("id", oid).single(); await supabase.from("operators").update({ settings: { ...(op?.settings ?? {}), messaging } }).eq("id", oid); setMsg("Messaging provider saved."); }

  return (
    <div>
      <div className="eyebrow">Connectors</div><h1>Booking systems and messaging</h1>
      {msg && <div className="notice">{msg}</div>}{err && <div className="notice err">{err}</div>}
      {KINDS.map((k) => { const c = conns.find((x) => x.kind === k.kind); return (
        <section key={k.kind} className="panel" style={{ marginTop: 16 }}>
          <div className="bar"><h2>{k.title}</h2>{c ? <span className={`tag ${c.status === "error" ? "t-bad" : c.status === "active" ? "t-ok" : "t-info"}`}>{c.status}{c.last_sync_at ? ` · synced ${new Date(c.last_sync_at).toLocaleString()}` : ""}</span> : <span className="tag t-warn">not connected</span>}</div>
          <p className="muted small">{k.help}</p>
          {c && <p className="small"><b>Webhook URL:</b> <code className="mono">{fnUrl(k.fn)}?token={c.webhook_token}</code></p>}
          {c?.last_error && <div className="notice err">{c.last_error}</div>}
          <div className="grid2">
            <div>{k.fields.map((f) => <div key={f.key}><label>{f.label}</label><input value={form[k.kind]?.[f.key] ?? c?.config?.[f.key] ?? ""} onChange={(e) => setForm({ ...form, [k.kind]: { ...(form[k.kind] ?? {}), [f.key]: e.target.value } })} /></div>)}</div>
            <div><label>API key {c?.has_secret ? "(saved, leave blank to keep)" : ""}</label><input type="password" value={form[k.kind]?.secret ?? ""} onChange={(e) => setForm({ ...form, [k.kind]: { ...(form[k.kind] ?? {}), secret: e.target.value } })} /></div>
          </div>
          <div className="bar"><button onClick={() => save(k.kind)}>Save</button>{c && <button className="ghost" disabled={busy} onClick={() => sync(k.kind, k.fn)}>Pull tomorrow's bookings now</button>}</div>
        </section>); })}

      {(() => { const g = conns.find((x) => x.kind === "gmail"); const MATCH: Record<string, string> = { supplier_confirmation: "supplier confirmation", transport_request: "transport request", booking: "booking", none: "no match" }; return (
      <section className="panel" style={{ marginTop: 16 }}>
        <div className="bar"><h2>Gmail</h2>{g ? <span className={`tag ${g.status === "error" ? "t-bad" : "t-ok"}`}>{g.config?.email ?? "connected"}{g.last_sync_at ? ` · inbox checked ${new Date(g.last_sync_at).toLocaleString()}` : " · not polled yet"}</span> : <span className="tag t-warn">not connected</span>}</div>
        <p className="muted small">Send supplier reconfirmations, coach requests and guest emails from your own Google Workspace address, and let DayRunner read the replies straight out of your inbox. Replies are matched to what we sent by thread, then by the supplier's email. DayRunner only reads and sends; it never deletes or moves mail.</p>
        <p className="muted small">Until Google has verified the DayRunner app, only Google accounts added as test users in Google Cloud can connect (limit 100). You will see an "unverified app" warning during consent; choose Continue.</p>
        {g?.last_error && <div className="notice err">{g.last_error}</div>}
        <div className="bar">
          <button disabled={busy || !oid} onClick={connectGmail}>{g ? "Reconnect Google" : "Connect Google"}</button>
          {g && <button className="ghost" disabled={busy} onClick={pollGmail}>Check inbox now</button>}
          {g && <button className="ghost" disabled={busy} onClick={disconnectGmail}>Disconnect</button>}
        </div>
        {g && inbound.length > 0 && (
          <table className="small" style={{ marginTop: 12, width: "100%" }}>
            <thead><tr><th>Received</th><th>From</th><th>Subject</th><th>Matched</th></tr></thead>
            <tbody>{inbound.map((m) => <tr key={m.id}><td>{m.received_at ? new Date(m.received_at).toLocaleString() : ""}</td><td>{m.from_email}</td><td>{m.subject}</td><td><span className={`tag ${m.matched_to === "none" ? "t-warn" : "t-ok"}`}>{MATCH[m.matched_to] ?? m.matched_to}</span></td></tr>)}</tbody>
          </table>)}
        {g && inbound.length === 0 && <p className="muted small">No inbound emails pulled yet. Click "Check inbox now" after a supplier replies.</p>}
      </section>); })()}

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Messaging provider</h2>
        <p className="muted small">Leave blank to run in manual mode: DayRunner drafts, you copy and send. Twilio covers WhatsApp and SMS. Resend covers email when Gmail is not connected (Gmail wins if both are set). Keys are stored against your operator record.</p>
        <div className="grid3">
          <div><label>Twilio Account SID</label><input value={messaging.twilio_sid ?? ""} onChange={(e) => setMessaging({ ...messaging, twilio_sid: e.target.value })} /><label>Twilio Auth Token</label><input type="password" value={messaging.twilio_token ?? ""} onChange={(e) => setMessaging({ ...messaging, twilio_token: e.target.value })} /></div>
          <div><label>SMS from number</label><input value={messaging.twilio_from ?? ""} onChange={(e) => setMessaging({ ...messaging, twilio_from: e.target.value })} placeholder="+64..." /><label>WhatsApp from number</label><input value={messaging.whatsapp_from ?? ""} onChange={(e) => setMessaging({ ...messaging, whatsapp_from: e.target.value })} placeholder="+64..." /></div>
          <div><label>Resend API key</label><input type="password" value={messaging.resend_key ?? ""} onChange={(e) => setMessaging({ ...messaging, resend_key: e.target.value })} /><label>Email from</label><input value={messaging.email_from ?? ""} onChange={(e) => setMessaging({ ...messaging, email_from: e.target.value })} placeholder="ops@yourtours.co.nz" /></div>
        </div>
        <div className="bar"><button onClick={saveMessaging}>Save provider</button></div>
      </section>
    </div>
  );
}
