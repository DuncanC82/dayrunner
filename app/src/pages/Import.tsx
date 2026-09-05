import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { useAuth } from "../lib/auth";
import { supabase, tomorrow } from "../lib/supabase";
import { parseItinerary, confirmationDetail, type ItineraryItem } from "../lib/itinerary";

const FIELDS = ["external_ref", "product", "date", "time", "lead_name", "pax", "pickup_location", "phone", "email", "source", "notes"] as const;
const guess = (h: string) => { const n = h.toLowerCase(); if (/ref|order|booking ?(id|no|number)|confirmation/.test(n)) return "external_ref"; if (/product|tour|item|experience|activity/.test(n)) return "product"; if (/^date|tour date|start date|departure date|travel date/.test(n)) return "date"; if (/time|start/.test(n)) return "time"; if (/name|customer|lead|guest/.test(n)) return "lead_name"; if (/pax|qty|quantity|guests|people|adults/.test(n)) return "pax"; if (/pickup|hotel|lodging|accommodation/.test(n)) return "pickup_location"; if (/phone|mobile|tel/.test(n)) return "phone"; if (/email/.test(n)) return "email"; if (/source|channel|agent|reseller/.test(n)) return "source"; if (/note|comment|special|request|extra/.test(n)) return "notes"; return ""; };

type Mode = "sheet" | "itinerary";
type Row = Record<string, unknown>;
type Edit = Partial<ItineraryItem> & { skip?: boolean };
const isSpreadsheet = (name: string) => /\.xlsx?$|\.xlsm$/i.test(name);

/** Rows from the given sheet: first non-empty row is the header. Dates come back formatted as text, times as HH:MM. */
function sheetRows(wb: XLSX.WorkBook, sheet: string): { headers: string[]; rows: Row[] } {
  const ws = wb.Sheets[sheet]; if (!ws) return { headers: [], rows: [] };
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, dateNF: "yyyy-mm-dd", defval: "" });
  const hi = grid.findIndex((r) => r.some((c) => String(c ?? "").trim())); if (hi < 0) return { headers: [], rows: [] };
  const headers = grid[hi].map((c, i) => String(c ?? "").trim() || `Column ${i + 1}`);
  const rows = grid.slice(hi + 1).filter((r) => r.some((c) => String(c ?? "").trim())).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  return { headers, rows };
}
/** Excel hands back d/m/y or y-m-d depending on the cell format; normalise to YYYY-MM-DD. */
function isoFromCell(s: string, fallback: string) { const t = s.trim(); if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10); const m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/); if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; } return fallback; }

export default function Import() {
  const { operator } = useAuth();
  const [mode, setMode] = useState<Mode>("sheet");
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [savedMap, setSavedMap] = useState<Record<string, string>>({});

  // ---- spreadsheet state ----
  const [rows, setRows] = useState<Row[]>([]); const [headers, setHeaders] = useState<string[]>([]); const [map, setMap] = useState<Record<string, string>>({}); const [date, setDate] = useState(tomorrow());
  const [wb, setWb] = useState<XLSX.WorkBook | null>(null); const [sheet, setSheet] = useState<string>(""); const [fileName, setFileName] = useState("");

  // ---- itinerary state ----
  const [text, setText] = useState(""); const [startDate, setStartDate] = useState(""); const [groupPax, setGroupPax] = useState<string>("");
  const [edits, setEdits] = useState<Record<number, Edit>>({});

  useEffect(() => { if (!operator) return; supabase.from("operators").select("settings").eq("id", operator.id).single().then(({ data }) => setSavedMap(data?.settings?.import_map ?? {})); }, [operator?.id]);

  /** Saved mapping wins where the header text matches; the rest is guessed. One field per column. */
  function buildMap(h: string[], saved: Record<string, string>) {
    const m: Record<string, string> = {};
    for (const x of h) if (saved[x] && (FIELDS as readonly string[]).includes(saved[x]) && !Object.values(m).includes(saved[x])) m[x] = saved[x];
    for (const x of h) { if (m[x]) continue; const g = guess(x); if (g && !Object.values(m).includes(g)) m[x] = g; }
    return m;
  }
  function loadSheet(book: XLSX.WorkBook, name: string) { const { headers: h, rows: r } = sheetRows(book, name); setHeaders(h); setRows(r); setMap(buildMap(h, savedMap)); setSheet(name); }
  async function onFile(f: File) {
    setMsg(null); setErr(null); setFileName(f.name);
    if (isSpreadsheet(f.name)) {
      const book = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true }); setWb(book);
      const first = book.SheetNames.find((n) => sheetRows(book, n).rows.length) ?? book.SheetNames[0]; loadSheet(book, first);
    } else {
      setWb(null); setSheet("");
      Papa.parse(f, { header: true, skipEmptyLines: true, complete: (r) => { const h = r.meta.fields ?? []; setHeaders(h); setRows(r.data as Row[]); setMap(buildMap(h, savedMap)); } });
    }
  }
  async function saveMap(m: Record<string, string>) {
    if (!operator) return; const { data: op } = await supabase.from("operators").select("settings").eq("id", operator.id).single();
    const next = { ...savedMap, ...m }; await supabase.from("operators").update({ settings: { ...(op?.settings ?? {}), import_map: next } }).eq("id", operator.id); setSavedMap(next);
  }
  async function runSheet() {
    if (!operator) return; setBusy(true); setMsg(null); setErr(null);
    try {
      const col = (f: string) => Object.entries(map).find(([, v]) => v === f)?.[0];
      const cell = (r: Row, f: string) => String(r[col(f) ?? ""] ?? "").trim();
      let n = 0; const depCache = new Map<string, string>();
      for (const r of rows) {
        const product = cell(r, "product") || "Tour"; const d = isoFromCell(cell(r, "date"), date); const t = (cell(r, "time").match(/\d{1,2}:\d{2}/)?.[0] ?? "09:00").padStart(5, "0");
        const key = `${d}|${t}|${product}`; let depId = depCache.get(key);
        if (!depId) { const { data: prod } = await supabase.from("products").select("id").eq("operator_id", operator.id).eq("name", product).maybeSingle(); const { data: dep, error } = await supabase.from("departures").upsert({ operator_id: operator.id, product_id: prod?.id ?? null, product_name: product, date: d, time: t }, { onConflict: "operator_id,date,time,product_name" }).select().single(); if (error) throw error; depId = dep.id as string; depCache.set(key, depId); }
        const ref = cell(r, "external_ref") || `${d}-${t}-${n}`;
        const { error } = await supabase.from("bookings").upsert({ operator_id: operator.id, departure_id: depId, external_ref: ref, source: cell(r, "source").toLowerCase() || "direct", lead_name: cell(r, "lead_name") || "Guest", pax: Number(cell(r, "pax")) || 1, pickup_location: cell(r, "pickup_location") || null, phone: cell(r, "phone") || null, email: cell(r, "email") || null, notes: cell(r, "notes") || null, raw: r }, { onConflict: "operator_id,external_ref" });
        if (error) throw error; n++;
      }
      await saveMap(map);
      setMsg(`Imported ${n} bookings into ${depCache.size} departures. Column mapping saved for next time. Go to Day and plan.`);
    } catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(false); }
  }

  // ---- itinerary ----
  const parsed = useMemo(() => parseItinerary(text, { startDate: startDate || null }), [text, startDate]);
  const pax = Number(groupPax) || parsed.groupPax || null;
  const items: (ItineraryItem & { skip?: boolean })[] = parsed.items.map((it, i) => ({ ...it, ...edits[i] }));
  const edit = (i: number, patch: Edit) => setEdits({ ...edits, [i]: { ...edits[i], ...patch } });
  const ready = items.filter((i) => !i.skip && i.date);

  async function runItinerary() {
    if (!operator) return; setBusy(true); setMsg(null); setErr(null);
    try {
      const oid = operator.id;
      if (!ready.length) throw new Error("Nothing to import: every line needs a date. Set the Day 1 date or add dates to the day headers.");
      const { data: existing } = await supabase.from("suppliers").select("id,name,product_names").eq("operator_id", oid);
      const supByName = new Map<string, { id: string; product_names: string[] }>((existing ?? []).map((s) => [String(s.name).toLowerCase(), { id: s.id, product_names: s.product_names ?? [] }]));
      const planByDate = new Map<string, string>(); let deps = 0, sups = 0, confs = 0, bks = 0;
      for (const it of ready) {
        const d = it.date!; const time = it.time ?? (it.category === "accommodation" ? "16:00" : "09:00");
        const { data: prod } = await supabase.from("products").select("id").eq("operator_id", oid).ilike("name", it.activity).maybeSingle();
        const { data: dep, error: de } = await supabase.from("departures").upsert({ operator_id: oid, product_id: prod?.id ?? null, product_name: it.activity, date: d, time, external_id: it.reference }, { onConflict: "operator_id,date,time,product_name" }).select().single();
        if (de) throw de; deps++;
        if (it.supplier) {
          // supplier: upsert by name; remember the activity in product_names so plan-day keeps emitting this confirmation
          const key = it.supplier.toLowerCase(); const template = `${it.category === "accommodation" ? "Overnight" : it.activity} for {pax} pax at {time} on {date}${it.reference ? ` (ref ${it.reference})` : ""}`;
          let supId: string; const have = supByName.get(key);
          if (have) { supId = have.id; if (!have.product_names.some((p) => p.toLowerCase() === it.activity.toLowerCase())) { const pn = [...have.product_names, it.activity]; await supabase.from("suppliers").update({ product_names: pn, detail_template: template }).eq("id", have.id); have.product_names = pn; } }
          else { const { data: s, error: se } = await supabase.from("suppliers").insert({ operator_id: oid, name: it.supplier, channel: "email", product_names: [it.activity], detail_template: template, confirm_by: "17:00 day before" }).select().single(); if (se) throw se; supId = s.id; supByName.set(key, { id: s.id, product_names: [it.activity] }); sups++; }
          // confirmation lives on the day's plan; create a draft plan if the day has not been planned yet
          let pid = planByDate.get(d);
          if (!pid) { const { data: p } = await supabase.from("plans").select("id").eq("operator_id", oid).eq("date", d).maybeSingle(); if (p) pid = p.id; else { const { data: np, error: pe } = await supabase.from("plans").insert({ operator_id: oid, date: d, status: "draft", generated_by: "itinerary-import", summary: { source: "itinerary" } }).select().single(); if (pe) throw pe; pid = np.id; } planByDate.set(d, pid!); }
          const detail = confirmationDetail(it, pax);
          await supabase.from("supplier_confirmations").delete().eq("plan_id", pid).eq("supplier_name", it.supplier).eq("detail", detail);
          const { error: ce } = await supabase.from("supplier_confirmations").insert({ plan_id: pid, operator_id: oid, supplier_id: supId, supplier_name: it.supplier, detail, due_label: "17:00 day before", status: "pending" }); if (ce) throw ce; confs++;
        }
        // bookings only when the itinerary names guests: one group booking per departure, lead = first guest, all names in notes
        if (parsed.guests.length) {
          const ref = `ITN-${d}-${(it.reference ?? it.activity).replace(/[^A-Za-z0-9]+/g, "").slice(0, 24).toUpperCase()}`;
          const { error: be } = await supabase.from("bookings").upsert({ operator_id: oid, departure_id: dep.id, external_ref: ref, source: "itinerary", lead_name: parsed.guests[0], pax: pax ?? parsed.guests.length, notes: `Group: ${parsed.guests.join(", ")}${it.note ? ` · ${it.note}` : ""}`, raw: { line: it.line, reference: it.reference } }, { onConflict: "operator_id,external_ref" }); if (be) throw be; bks++;
        }
      }
      await supabase.from("audit_log").insert({ operator_id: oid, actor: "import", action: "itinerary.imported", entity: "departures", detail: { departures: deps, suppliers_created: sups, confirmations: confs, bookings: bks, dates: [...planByDate.keys()] } });
      setMsg(`Imported ${deps} departures, ${sups} new suppliers, ${confs} supplier confirmations${bks ? `, ${bks} group bookings` : " (no guest names found, so no bookings)"} across ${new Set(ready.map((u) => u.date)).size} day(s). Go to Day, pick the date and plan.`);
    } catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(false); }
  }

  const tab = (m: Mode, label: string) => <button className={mode === m ? "sm" : "sm ghost"} onClick={() => { setMode(m); setMsg(null); setErr(null); }}>{label}</button>;

  return (
    <div>
      <div className="eyebrow">Import</div><h1>Bring tomorrow in from wherever it lives</h1>
      <div className="bar">{tab("sheet", "Spreadsheet or CSV")}{tab("itinerary", "Itinerary")}</div>
      {msg && <div className="notice">{msg}</div>}{err && <div className="notice err">{err}</div>}

      {mode === "sheet" && <>
        <p className="muted">Export tomorrow's bookings as CSV or Excel from Rezdy, FareHarbor, Bókun, Checkfront, RCM, or drop in your own bookings workbook. Columns are matched automatically and your mapping is remembered.</p>
        <div className="bar"><input type="file" accept=".csv,.xlsx,.xls,.xlsm" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} style={{ width: "auto" }} /><label style={{ margin: 0 }}>Default date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} />
          {wb && wb.SheetNames.length > 1 && <><label style={{ margin: 0 }}>Sheet</label><select value={sheet} onChange={(e) => loadSheet(wb, e.target.value)} style={{ width: "auto" }}>{wb.SheetNames.map((n) => <option key={n} value={n}>{n}</option>)}</select></>}</div>
        {headers.length > 0 && <>
          <div className="wrap"><table><thead><tr><th>{fileName} column</th><th>Maps to</th><th>Sample</th></tr></thead><tbody>
            {headers.map((h) => <tr key={h}><td>{h}{savedMap[h] && savedMap[h] === map[h] ? <span className="muted"> · saved</span> : null}</td><td><select value={map[h] ?? ""} onChange={(e) => setMap({ ...map, [h]: e.target.value })}><option value="">ignore</option>{FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}</select></td><td className="muted">{String(rows[0]?.[h] ?? "")}</td></tr>)}
          </tbody></table></div>
          <div className="bar"><button onClick={runSheet} disabled={busy}>Import {rows.length} rows</button><button className="ghost" onClick={() => saveMap(map).then(() => setMsg("Mapping saved."))} disabled={busy}>Save mapping only</button></div>
        </>}
      </>}

      {mode === "itinerary" && <>
        <p className="muted">No booking system? Paste the itinerary you built. Each timed line becomes a departure; every named venue becomes a supplier with its reference on the confirmation list. Meals are spotted by breakfast, lunch and dinner words. Nothing is written until you confirm.</p>
        <div className="bar"><input type="file" accept=".txt,.md,.text" onChange={(e) => e.target.files?.[0]?.text().then(setText)} style={{ width: "auto" }} /><label style={{ margin: 0 }}>Day 1 date (if the itinerary has none)</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ width: 170 }} /><label style={{ margin: 0 }}>Group pax</label><input type="number" min={1} value={groupPax} placeholder={parsed.groupPax ? String(parsed.groupPax) : "e.g. 14"} onChange={(e) => setGroupPax(e.target.value)} style={{ width: 90 }} /></div>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setEdits({}); }} rows={12} placeholder={"Day 1 – Monday 12 October 2026\n08:30 Skyline Gondola (ref SG-2231)\n12:30 Lunch – Fergburger\nGlacier Explorers 14:00 booking 5567\nOvernight Rainforest Retreat (conf RR-10921)\n\nGuests: Wei Ling Tan, Marcus Tan"} style={{ width: "100%", fontFamily: "inherit" }} />
        {text.trim() && <>
          <div className="bar muted">{parsed.days} day(s) · {items.length} lines recognised · {parsed.guests.length ? `${parsed.guests.length} guests: ${parsed.guests.join(", ")}` : "no guest names, so no bookings will be created"} · pax {pax ?? "not set"}{parsed.skipped.length ? ` · ${parsed.skipped.length} lines skipped` : ""}</div>
          <div className="wrap"><table><thead><tr><th></th><th>Day</th><th>Date</th><th>Time</th><th>Activity (product)</th><th>Supplier</th><th>Reference</th><th>Type</th><th>Pax</th><th>Flags</th></tr></thead><tbody>
            {items.map((it, i) => <tr key={i} style={it.skip ? { opacity: .45 } : undefined}>
              <td><input type="checkbox" checked={!it.skip} onChange={(e) => edit(i, { skip: !e.target.checked })} style={{ width: "auto" }} /></td>
              <td className="num">{it.day}</td>
              <td><input type="date" value={it.date ?? ""} onChange={(e) => edit(i, { date: e.target.value || null })} style={{ width: 150 }} /></td>
              <td><input type="time" value={it.time ?? ""} onChange={(e) => edit(i, { time: e.target.value || null })} style={{ width: 110 }} /></td>
              <td><input value={it.activity} onChange={(e) => edit(i, { activity: e.target.value })} style={{ minWidth: 160 }} /></td>
              <td><input value={it.supplier ?? ""} onChange={(e) => edit(i, { supplier: e.target.value || null })} style={{ minWidth: 160 }} /></td>
              <td><input value={it.reference ?? ""} onChange={(e) => edit(i, { reference: e.target.value || null })} style={{ width: 110 }} /></td>
              <td><select value={it.category} onChange={(e) => edit(i, { category: e.target.value as ItineraryItem["category"] })} style={{ width: "auto" }}><option value="activity">activity</option><option value="meal">meal</option><option value="accommodation">accommodation</option></select></td>
              <td className="num">{it.pax ?? pax ?? ""}</td>
              <td className="muted">{[...it.warnings, it.note ?? ""].filter(Boolean).join(" · ")}</td>
            </tr>)}
          </tbody></table></div>
          {parsed.skipped.length > 0 && <details><summary className="muted">Skipped lines ({parsed.skipped.length})</summary><ul className="muted">{parsed.skipped.map((s, i) => <li key={i}>{s}</li>)}</ul></details>}
          <div className="bar"><button onClick={runItinerary} disabled={busy || !ready.length}>Create {ready.length} departures and suppliers</button>{items.some((i) => !i.skip && !i.date) && <span className="muted">Lines without a date are not imported. Set the Day 1 date.</span>}</div>
        </>}
      </>}
    </div>
  );
}
