import { useState } from "react";
import Papa from "papaparse";
import { useAuth } from "../lib/auth";
import { supabase, tomorrow } from "../lib/supabase";

const FIELDS = ["external_ref", "product", "date", "time", "lead_name", "pax", "pickup_location", "phone", "email", "source", "notes"] as const;
const guess = (h: string) => { const n = h.toLowerCase(); if (/ref|order|booking ?(id|no|number)|confirmation/.test(n)) return "external_ref"; if (/product|tour|item|experience/.test(n)) return "product"; if (/^date|tour date|start date|departure date/.test(n)) return "date"; if (/time|start/.test(n)) return "time"; if (/name|customer|lead|guest/.test(n)) return "lead_name"; if (/pax|qty|quantity|guests|people|adults/.test(n)) return "pax"; if (/pickup|hotel|lodging|accommodation/.test(n)) return "pickup_location"; if (/phone|mobile|tel/.test(n)) return "phone"; if (/email/.test(n)) return "email"; if (/source|channel|agent|reseller/.test(n)) return "source"; if (/note|comment|special|request|extra/.test(n)) return "notes"; return ""; };

export default function Import() {
  const { operator } = useAuth();
  const [rows, setRows] = useState<any[]>([]); const [headers, setHeaders] = useState<string[]>([]); const [map, setMap] = useState<Record<string, string>>({}); const [date, setDate] = useState(tomorrow()); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  function onFile(f: File) { Papa.parse(f, { header: true, skipEmptyLines: true, complete: (r) => { const h = r.meta.fields ?? []; setHeaders(h); setRows(r.data as any[]); const m: Record<string, string> = {}; for (const x of h) { const g = guess(x); if (g && !Object.values(m).includes(g)) m[x] = g; } setMap(m); } }); }
  async function run() {
    if (!operator) return; setBusy(true); setMsg(null);
    const col = (f: string) => Object.entries(map).find(([, v]) => v === f)?.[0];
    let n = 0; const depCache = new Map<string, string>();
    for (const r of rows) {
      const product = String(r[col("product") ?? ""] ?? "Tour").trim(); const d = String(r[col("date") ?? ""] ?? date).slice(0, 10) || date; const t = (String(r[col("time") ?? ""] ?? "09:00").match(/\d{1,2}:\d{2}/)?.[0] ?? "09:00").padStart(5, "0");
      const key = `${d}|${t}|${product}`; let depId = depCache.get(key);
      if (!depId) { const { data: prod } = await supabase.from("products").select("id").eq("operator_id", operator.id).eq("name", product).maybeSingle(); const { data: dep } = await supabase.from("departures").upsert({ operator_id: operator.id, product_id: prod?.id ?? null, product_name: product, date: d, time: t }, { onConflict: "operator_id,date,time,product_name" }).select().single(); depId = dep!.id; depCache.set(key, depId!); }
      const ref = String(r[col("external_ref") ?? ""] ?? "").trim() || `${d}-${t}-${n}`;
      await supabase.from("bookings").upsert({ operator_id: operator.id, departure_id: depId, external_ref: ref, source: String(r[col("source") ?? ""] ?? "direct").toLowerCase() || "direct", lead_name: String(r[col("lead_name") ?? ""] ?? "Guest"), pax: Number(r[col("pax") ?? ""] ?? 1) || 1, pickup_location: r[col("pickup_location") ?? ""] || null, phone: r[col("phone") ?? ""] || null, email: r[col("email") ?? ""] || null, notes: r[col("notes") ?? ""] || null, raw: r }, { onConflict: "operator_id,external_ref" });
      n++;
    }
    setBusy(false); setMsg(`Imported ${n} bookings. Go to Day and plan.`);
  }
  return (
    <div>
      <div className="eyebrow">Import</div><h1>Manifest from any booking system</h1>
      <p className="muted">Export tomorrow's bookings as CSV from Rezdy, FareHarbor, Bókun, Checkfront, RCM or a spreadsheet. Columns are matched automatically; fix any that guessed wrong.</p>
      <div className="bar"><input type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} style={{ width: "auto" }} /><label style={{ margin: 0 }}>Default date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} /></div>
      {msg && <div className="notice">{msg}</div>}
      {headers.length > 0 && <>
        <div className="wrap"><table><tr><th>CSV column</th><th>Maps to</th><th>Sample</th></tr>
          {headers.map((h) => <tr key={h}><td>{h}</td><td><select value={map[h] ?? ""} onChange={(e) => setMap({ ...map, [h]: e.target.value })}><option value="">ignore</option>{FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}</select></td><td className="muted">{String(rows[0]?.[h] ?? "")}</td></tr>)}
        </table></div>
        <div className="bar"><button onClick={run} disabled={busy}>Import {rows.length} rows</button></div>
      </>}
    </div>
  );
}
