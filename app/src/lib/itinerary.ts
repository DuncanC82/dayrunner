// Deterministic itinerary parser. No network, no LLM.
// Turns pasted itinerary text into ItineraryItems (one per activity/meal/stay line)
// plus any guest names found, so an operator with no booking system can run a day.

export type ItineraryCategory = "meal" | "activity" | "accommodation";

export type ItineraryItem = {
  day: number;              // 1-based day index within the itinerary
  date: string | null;      // YYYY-MM-DD, null if no date could be resolved
  time: string | null;      // HH:MM 24h, null if the line had no time
  activity: string;         // product_name for the departure
  supplier: string | null;  // supplier name (null if the line is a pure note)
  reference: string | null; // supplier booking reference
  note: string | null;      // trailing parenthetical on the line, e.g. "no booking, pay direct"
  category: ItineraryCategory;
  pax: number | null;       // pax written on the line, else null (caller applies the group pax)
  line: string;             // source line, for the preview and for departures.external_id fallback
  warnings: string[];
};

export type ItineraryParse = {
  items: ItineraryItem[];
  guests: string[];         // lead names found in a "Guests:" / "Passengers:" block
  groupPax: number | null;  // pax found in a header line like "12 pax" or "Group: 14"
  days: number;
  skipped: string[];        // non-empty lines that were not turned into items
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MEAL = /\b(breakfast|brunch|lunch|dinner|supper|morning tea|afternoon tea|smoko|picnic|meal|cafe|café|restaurant|bistro|eatery|pub meal)\b/i;
const STAY = /\b(overnight|accommodation|accomodation|check[- ]?in|check[- ]?out|hotel|motel|lodge|retreat|resort|holiday park|b&b|bnb|hostel|stay at)\b/i;
const NOISE = /^(drive|travel|depart|depart(ure)? from|continue|transfer|free time|leisure|rest stop|comfort stop|photo stop|toilet stop|scenic drive)\b/i;
const REF = /(?:\b(?:ref(?:erence)?|booking|bkg|conf(?:irmation)?|res(?:ervation)?|order|voucher|pnr)\b\s*(?:no\.?|num(?:ber)?|id)?\s*[:#.-]?\s*|#\s*)([A-Za-z0-9][A-Za-z0-9\/-]{2,})/i;
const PAREN_REF = /\(\s*([A-Z]{1,5}[-\/]?\d{3,}[A-Z0-9-]*)\s*\)/;
const TIME = /\b(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm|hrs|h)?\b/i;
const PAX = /\b(\d{1,3})\s*(?:pax|people|persons|guests|passengers|adults|ppl)\b|\bx\s*(\d{1,3})\b/i;

export function pad(n: number) { return String(n).padStart(2, "0"); }
export function isoDate(y: number, m: number, d: number) { return `${y}-${pad(m)}-${pad(d)}`; }
export function addDays(iso: string, n: number) { const [y, m, d] = iso.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }

/** Find a calendar date in a line. Handles 2026-10-12, 12/10/2026, 12 Oct 2026, Monday 12 October, Oct 12. */
export function findDate(line: string, defaultYear = new Date().getFullYear()): string | null {
  let m = line.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = line.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2}|\d{2})\b/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return isoDate(y, +m[2], +m[1]); } // NZ day/month order
  m = line.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\.?(?:\s+(20\d{2}))?\b/i);
  if (m) return isoDate(m[3] ? +m[3] : defaultYear, MONTHS[m[2].toLowerCase()], +m[1]);
  m = line.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/i);
  if (m) return isoDate(m[3] ? +m[3] : defaultYear, MONTHS[m[1].toLowerCase()], +m[2]);
  return null;
}

/** Parse a time token to HH:MM. Accepts 08:30, 8.30am, 1430, 2pm, 14h00. */
export function findTime(line: string): { time: string; raw: string } | null {
  // military 4-digit first e.g. "1430hrs" or bare "0830"
  const mil = line.match(/\b([01]\d|2[0-3])([0-5]\d)\s*(?:hrs|h)?\b/);
  if (mil && !/\d{5,}/.test(mil[0]) && !/[\/-]/.test(line.slice(Math.max(0, (mil.index ?? 0) - 1), (mil.index ?? 0) + mil[0].length + 1))) {
    return { time: `${mil[1]}:${mil[2]}`, raw: mil[0] };
  }
  const re = new RegExp(TIME.source, "gi"); let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const h = +m[1], mm = m[2] ? +m[2] : 0, ap = (m[3] ?? "").toLowerCase();
    if (!m[2] && !/(am|pm)/.test(ap)) continue;            // a bare number is not a time
    if (h > 24 || mm > 59) continue;
    // reject if part of a date like 12/10 or a ref like SG-2231
    const before = line[m.index - 1] ?? " ", after = line[m.index + m[0].length] ?? " ";
    if (/[\/\-\dA-Za-z]/.test(before) || /[\/\-]/.test(after)) continue;
    let H = h; if (ap === "pm" && h < 12) H += 12; if (ap === "am" && h === 12) H = 0;
    return { time: `${pad(H)}:${pad(mm)}`, raw: m[0] };
  }
  return null;
}

export function guessCategory(text: string): ItineraryCategory {
  if (MEAL.test(text)) return "meal";
  if (STAY.test(text)) return "accommodation";
  return "activity";
}

function clean(s: string) { return s.replace(/\s+/g, " ").replace(/^[\s\-–—•·*:,.@]+|[\s\-–—•·*:,.@]+$/g, "").trim(); }

/** Extract a supplier reference. Returns [reference, textWithoutReference]. */
export function findReference(line: string): [string | null, string] {
  let m = line.match(REF);
  if (m && !/^\d{1,2}[:.]\d{2}$/.test(m[1])) return [m[1].toUpperCase(), (line.slice(0, m.index) + " " + line.slice((m.index ?? 0) + m[0].length)).replace(/\(\s*\)/g, "")];
  m = line.match(PAREN_REF);
  if (m) return [m[1].toUpperCase(), line.replace(m[0], " ")];
  return [null, line];
}

/** Split "Lunch – Fergburger" / "Skyline Gondola with NZSki" / "Dinner at Botswana Butchery" into activity + supplier. */
export function splitActivitySupplier(text: string, category: ItineraryCategory): { activity: string; supplier: string | null } {
  const t = clean(text);
  const sep = t.match(/\s+(?:[–—-]|@|\bat\b|\bwith\b|\bby\b|\bvia\b)\s+/i);
  if (sep && sep.index !== undefined) {
    const a = clean(t.slice(0, sep.index)), b = clean(t.slice(sep.index + sep[0].length));
    if (a && b) {
      // "Lunch – Fergburger" → activity Lunch, supplier Fergburger. "Fergburger – Lunch" → the same.
      if (category !== "activity" && (MEAL.test(b) || STAY.test(b)) && !(MEAL.test(a) || STAY.test(a))) return { activity: b, supplier: a };
      return { activity: a, supplier: b };
    }
  }
  if (category === "meal") {
    // "Lunch Fergburger" (no separator): activity is the meal word(s), supplier the rest
    const m = t.match(MEAL);
    if (m && m.index !== undefined) { const rest = clean(t.slice(0, m.index) + " " + t.slice(m.index + m[0].length)); if (rest) return { activity: clean(m[0]), supplier: rest }; }
    return { activity: t, supplier: null };
  }
  if (category === "accommodation") {
    const rest = clean(t.replace(/\b(overnight|accommodation|accomodation|check[- ]?in|check[- ]?out|stay at)\b/gi, " "));
    return { activity: "Overnight", supplier: rest || null };
  }
  // An activity with no explicit supplier: the operator names it after the supplier ("Glacier Explorers 14:00").
  return { activity: t, supplier: t };
}

function dayHeader(line: string): { day: number | null; date: string | null } | null {
  const m = line.match(/^\s*(?:day|d)\s*(\d{1,2})\b(.*)$/i);
  const date = findDate(line);
  if (m) return { day: +m[1], date };
  // A line that is only a date (optionally with a weekday) is also a header.
  if (date && /^\s*(?:(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s*)?[\d\/\-.a-z\s,]+$/i.test(line) && line.length < 40) return { day: null, date };
  return null;
}

export function parseItinerary(text: string, opts: { startDate?: string | null } = {}): ItineraryParse {
  const lines = text.replace(/\r/g, "").split("\n");
  const items: ItineraryItem[] = []; const guests: string[] = []; const skipped: string[] = [];
  let day = 0, date: string | null = opts.startDate ?? null, groupPax: number | null = null, inGuests = false, sawHeader = false;
  const dayDates = new Map<number, string>();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { inGuests = false; continue; }

    // Guest block: "Guests:" / "Passengers:" / "Names:" then comma-separated or one-per-line names.
    const g = line.match(/^(?:guests?|passengers?|pax names?|names?|travellers?|clients?)\s*(?:list)?\s*[:\-–]\s*(.*)$/i);
    if (g) { inGuests = true; pushNames(g[1]); continue; }
    if (inGuests && !dayHeader(line) && !findTime(line) && /^[A-Za-z][A-Za-z' .&-]+(,\s*[A-Za-z][A-Za-z' .&-]+)*$/.test(line) && line.length < 80) { pushNames(line); continue; }
    inGuests = false;

    const hdr = dayHeader(line);
    if (hdr) {
      sawHeader = true;
      day = hdr.day ?? day + 1;
      if (hdr.date) date = hdr.date; else if (opts.startDate) date = addDays(opts.startDate, day - 1); else if (day > 1 && dayDates.get(day - 1)) date = addDays(dayDates.get(day - 1)!, 1);
      if (date) dayDates.set(day, date);
      const p = line.match(PAX); if (p && !groupPax) groupPax = +(p[1] ?? p[2]);
      // A header can still carry an item, e.g. "Day 2 – 14:00 Glacier Explorers". Fall through only if it has a time.
      if (!findTime(line.replace(/\b20\d{2}\b/, ""))) continue;
    }
    if (!sawHeader && day === 0) { day = 1; if (date) dayDates.set(1, date); }

    // Header-ish metadata lines before any day: "Group: 14 pax", "Tour: South Island Explorer".
    if (!items.length && !hdr) { const p = line.match(PAX); if (p && !findTime(line) && /^(group|party|pax|numbers|total|passengers|guests)\b/i.test(line)) { groupPax = +(p[1] ?? p[2]); continue; } }

    const t = findTime(line);
    const [reference, noRef] = findReference(line);
    let body = noRef; if (t) body = body.replace(t.raw, " ");
    if (hdr) body = body.replace(/^\s*(?:day|d)\s*\d{1,2}\b/i, " ").replace(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?/i, " ").replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\.?(?:\s+20\d{2})?\b/i, " ").replace(/\b20\d{2}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}\b/, " ");
    const p = body.match(PAX); let pax: number | null = null; if (p) { pax = +(p[1] ?? p[2]); body = body.replace(p[0], " "); }
    let note: string | null = null; const paren = body.match(/\(([^()]{3,})\)\s*$/); if (paren) { note = clean(paren[1]); body = body.replace(paren[0], " "); }
    body = clean(body.replace(/\(\s*\)/g, ""));
    const category = guessCategory(body);
    const worth = !!t || !!reference || category !== "activity";
    if (!body || (!worth) || (NOISE.test(body) && !reference && category === "activity")) { skipped.push(line); continue; }

    const { activity, supplier } = splitActivitySupplier(body, category);
    const warnings: string[] = [];
    if (!date) warnings.push("no date");
    if (!t) warnings.push("no time");
    if (!reference) warnings.push("no reference");
    items.push({ day, date, time: t?.time ?? null, activity, supplier, reference, note, category, pax, line, warnings });
  }

  function pushNames(s: string) { for (const n of s.split(/[,;\/]|\band\b/i).map(clean).filter(Boolean)) if (/[A-Za-z]/.test(n) && !guests.includes(n)) guests.push(n); }

  return { items, guests, groupPax, days: Math.max(day, items.reduce((a, i) => Math.max(a, i.day), 0)), skipped };
}

/** The supplier detail text stored on the confirmation and used as the supplier's detail_template. */
export function confirmationDetail(i: ItineraryItem, pax: number | null): string {
  const bits = [`${i.activity}${i.date ? ` on ${i.date}` : ""}${i.time ? ` at ${i.time}` : ""}`];
  if (pax) bits.push(`${pax} pax`);
  if (i.reference) bits.push(`ref ${i.reference}`);
  if (i.note) bits.push(i.note);
  return bits.join(", ");
}

// ---------------------------------------------------------------------------
// Tours (docs/features/tours.md): turn a parse into tour + tour_days + stops.

export type StopCategory = "activity" | "meal_breakfast" | "meal_lunch" | "meal_dinner" | "accommodation" | "transport" | "other";

export type TourDraft = {
  tour: { name: string; start_date: string | null; end_date: string | null; group_pax: number | null; status: string; notes: string | null };
  days: { day_number: number; date: string | null; title: string | null; overnight_location: string | null }[];
  stops: { day_number: number; time: string | null; name: string; category: StopCategory; supplier: string | null; reference: string | null; blurb: string | null; sequence: number; itemIndex: number }[];
};

/** Map a parsed item to a stop category: meals split by meal word, stays to accommodation. */
export function stopCategory(i: Pick<ItineraryItem, "category" | "activity" | "line">): StopCategory {
  if (i.category === "accommodation") return "accommodation";
  if (i.category === "meal") {
    const t = `${i.activity} ${i.line}`.toLowerCase();
    if (/breakfast|brunch/.test(t)) return "meal_breakfast";
    if (/dinner|supper/.test(t)) return "meal_dinner";
    return "meal_lunch";
  }
  return "activity";
}

/** Tour name: the first non-empty line of the paste before any day header, else a fallback. */
export function tourNameFromText(text: string, fallback = "Imported tour"): string {
  const first = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).find(Boolean);
  if (!first || /^(?:day|d)\s*\d/i.test(first) || findDate(first)) return fallback;
  return first.replace(/\s*[–—-]\s*.*$/, "").slice(0, 80) || fallback;
}

/**
 * Build the rows for a tour from a parse. Pure; the caller writes them (see `writeTour`).
 * Items with `skip` are left out. Day titles come from the day-header text after the date when
 * available in `opts.dayTitles`, else null. Overnight location = the accommodation supplier for the day.
 */
export function tourFromItinerary(parse: Pick<ItineraryParse, "items" | "groupPax">, opts: { name: string; text?: string; groupPax?: number | null; items?: (ItineraryItem & { skip?: boolean })[] } ): TourDraft {
  const items = (opts.items ?? parse.items).map((it, i) => ({ it, i })).filter(({ it }) => !(it as any).skip);
  const dayNums = [...new Set(items.map(({ it }) => it.day))].sort((a, b) => a - b);
  const dateOf = (d: number) => items.find(({ it }) => it.day === d && it.date)?.it.date ?? null;
  const titles = opts.text ? dayTitles(opts.text) : new Map<number, string>();
  const days = dayNums.map((d) => ({
    day_number: d, date: dateOf(d), title: titles.get(d) ?? null,
    overnight_location: items.find(({ it }) => it.day === d && it.category === "accommodation")?.it.supplier ?? null,
  }));
  const stops: TourDraft["stops"] = []; const seq = new Map<number, number>();
  for (const { it, i } of items) {
    const s = (seq.get(it.day) ?? 0) + 1; seq.set(it.day, s);
    const name = it.category === "accommodation" ? `Overnight – ${it.supplier ?? it.activity}` : (it.supplier && it.supplier !== it.activity ? `${it.activity} – ${it.supplier}` : it.activity);
    stops.push({ day_number: it.day, time: it.time, name, category: stopCategory(it), supplier: it.supplier, reference: it.reference, blurb: it.note, sequence: s, itemIndex: i });
  }
  const dates = days.map((d) => d.date).filter((d): d is string => !!d).sort();
  return { tour: { name: opts.name, start_date: dates[0] ?? null, end_date: dates[dates.length - 1] ?? null, group_pax: opts.groupPax ?? parse.groupPax ?? null, status: "draft", notes: null }, days, stops };
}

/** "Day 1 – Monday 12 October 2026 – Queenstown to Franz Josef" → { 1: "Queenstown to Franz Josef" }. */
export function dayTitles(text: string): Map<number, string> {
  const out = new Map<number, string>(); let n = 0;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const m = raw.trim().match(/^(?:day|d)\s*(\d{1,2})\b(.*)$/i); if (!m) continue;
    n = +m[1]; const parts = m[2].split(/\s+[–—-]\s+/).map((p) => p.trim()).filter(Boolean);
    const title = parts.filter((p) => !findDate(p) && !/^(mon|tue|wed|thu|fri|sat|sun)/i.test(p)).pop();
    if (title) out.set(n, title);
  }
  return out;
}

/**
 * Write a TourDraft with a supabase client. Returns ids so the caller can link departures
 * (`departures.tour_id` / `tour_day_id`) by itemIndex. Suppliers are linked by case-insensitive name.
 */
export async function writeTour(sb: any, operatorId: string, draft: TourDraft, notes: { itemIndex: number; audience: "guide" | "group" | "office" | "driver"; body: string }[] = []) {
  const { data: tour, error: te } = await sb.from("tours").insert({ operator_id: operatorId, ...draft.tour }).select().single(); if (te) throw te;
  const { data: days, error: de } = await sb.from("tour_days").insert(draft.days.map((d) => ({ ...d, tour_id: tour.id, operator_id: operatorId }))).select(); if (de) throw de;
  const dayId = new Map<number, string>((days ?? []).map((d: any) => [d.day_number, d.id]));
  const { data: sups } = await sb.from("suppliers").select("id,name,contact,email").eq("operator_id", operatorId);
  const supByName = new Map<string, any>((sups ?? []).map((s: any) => [String(s.name).toLowerCase(), s]));
  const rows = draft.stops.map((s) => { const sup = s.supplier ? supByName.get(s.supplier.toLowerCase()) : null; return { operator_id: operatorId, tour_id: tour.id, tour_day_id: dayId.get(s.day_number), time: s.time, name: s.name, category: s.category, supplier_id: sup?.id ?? null, phone: sup?.contact && /\d{5,}/.test(sup.contact) ? sup.contact : null, address: null, reference: s.reference, blurb: s.blurb, sequence: s.sequence }; });
  const { data: stops, error: se } = await sb.from("stops").insert(rows).select(); if (se) throw se;
  const stopByItem = new Map<number, string>(draft.stops.map((s, k) => [s.itemIndex, stops[k].id]));
  if (notes.length) { const { error: ne } = await sb.from("stop_notes").insert(notes.filter((n) => stopByItem.has(n.itemIndex)).map((n) => ({ operator_id: operatorId, stop_id: stopByItem.get(n.itemIndex), audience: n.audience, body: n.body }))); if (ne) throw ne; }
  return { tourId: tour.id as string, dayId, stopByItem };
}
