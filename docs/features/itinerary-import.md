# Feature: Import from a spreadsheet or an itinerary

Status: built (v1) · Owner: Duncan Crawford · 6 September 2026 · Surface: `app/src/pages/Import.tsx`, `app/src/lib/itinerary.ts`

## 1. Problem

A large share of NZ coach, charter and inbound operators have no booking system. Bookings live in an Excel workbook; the day itself is defined by an itinerary document the operator wrote for the client, which names every supplier (activities, meals, accommodation) and the reference each supplier issued. DayRunner's core loop starts from "pull tomorrow's departures and bookings", so without an import path these operators cannot run a day at all.

The existing CSV import assumed a booking-system export: one row per booking with a product, date and time. That does not fit an itinerary, and it did not open `.xlsx`, which is what these operators actually have.

## 2. Evidence

Operator call, September 2026 (verbatim):

> "I build their itinerary, which has all that information included, as well as references, but then they become a supplier, an operator."

> "Oh yeah, but the bookings, where do the bookings go? Do you just have an Excel spreadsheet for the bookings? Yes."

Read: the itinerary *is* the day plan and the supplier list; the spreadsheet *is* the booking system. Both already exist, so import them rather than asking the operator to re-key into DayRunner.

## 3. User stories

1. As a coordinator with a bookings workbook, I can drop the `.xlsx` (or `.csv`) on Import, pick the sheet, check the column mapping once, and get departures and bookings for the day. Next time the mapping is already right.
2. As a coordinator with an itinerary, I can paste it, set the group size once, see exactly what DayRunner will create (date, time, activity, supplier, reference), fix anything it misread, and confirm.
3. After confirming, the Day view shows those departures and a supplier confirmation per named venue carrying the reference, so I can ring or email each supplier from one list.
4. If the itinerary lists guest names, a group booking exists on each departure so pickups and messages have someone to address. If it does not, no bookings are invented.
5. Nothing is written until I confirm, and I can re-run the same itinerary without duplicates.

## 4. Column-mapping model (spreadsheet mode)

- Target fields (unchanged): `external_ref, product, date, time, lead_name, pax, pickup_location, phone, email, source, notes`.
- File handling: `.csv` via PapaParse; `.xlsx/.xls/.xlsm` via the `xlsx` package. The first sheet that contains data is chosen; a sheet picker appears when a workbook has more than one. The first non-empty row is the header. Cell values are read formatted (`raw:false`) so Excel dates arrive as text and times as `HH:MM`; the date column is sliced to 10 characters and the time column matched with `\d{1,2}:\d{2}`.
- Guessing: header regexes (`ref|order|booking id`, `product|tour|item|experience|activity`, `date`, `time|start`, `name|customer|lead|guest`, `pax|qty|guests|adults`, `pickup|hotel|accommodation`, `phone|mobile`, `email`, `source|channel|agent|reseller`, `note|comment|special`). One target field per column.
- Persistence: `operators.settings.import_map` is `{ [headerText]: field }`. On file load, saved entries win where the header text matches; the rest are guessed. The map is saved automatically after a successful import and on "Save mapping only". Saving merges into the existing map so different exports (Rezdy, the operator's own workbook) coexist. Read-modify-write on `settings` so the messaging config saved by Connectors is preserved.
- Writes: identical to the previous CSV path. Departures upsert on `(operator_id,date,time,product_name)`; bookings upsert on `(operator_id,external_ref)`; `raw` keeps the source row.

## 5. Itinerary model

### 5.1 Parsing (deterministic, `parseItinerary(text, { startDate })`)

Line by line:

- **Day header**: `Day N …` or a line that is only a date. Date formats: `2026-10-12`, `12/10/2026` (NZ day/month), `12 Oct 2026`, `Monday 12 October`, `Oct 12`. A header with no date takes `startDate + (N-1)`, or the previous day + 1.
- **Guest block**: a line starting `Guests:` / `Passengers:` / `Names:` followed by comma-separated names, continuing on following lines until a blank line or a timed line.
- **Group pax**: `14 pax`, `x 14`, `Group: 14` in a header or a pre-itinerary metadata line. Overridden by the pax the user types.
- **Time**: `08:30`, `8.30am`, `7pm`, `1830`, `14h00`. Digits adjacent to `/`, `-` or letters are rejected so `12/10` and `SG-2231` are not times.
- **Reference**: `ref|reference|booking|bkg|conf|confirmation|res|reservation|order|voucher|pnr|#` followed by an optional `no/number/id` and the token; or a parenthesised token that looks like a code (`(SG-2231)`). Upper-cased.
- **Category**: `meal` if a meal word is present (breakfast, brunch, lunch, dinner, supper, morning/afternoon tea, cafe, restaurant, bistro…); `accommodation` if overnight/check-in/hotel/lodge/retreat…; otherwise `activity`.
- **Activity vs supplier**: split on ` – `, ` - `, ` @ `, ` at `, ` with `, ` by `, ` via `. For meals the meal word is the activity and the venue is the supplier, whichever side it is on. For accommodation the activity is "Overnight" and the venue is the supplier. For a bare activity (`Glacier Explorers 14:00 booking 5567`) the supplier is the activity itself, which is how these operators name things.
- **Note**: a trailing parenthetical that is not a reference (`(no booking, pay direct)`).
- **Kept vs skipped**: a line is an item if it has a time, a reference, or a meal/accommodation word. Route narration (`Drive via Haast Pass…`), titles and vehicle notes are listed under "Skipped lines" so nothing disappears silently.
- Every item carries `warnings` (`no date`, `no time`, `no reference`) shown as flags in the preview.

### 5.2 Preview

One editable row per item: include checkbox, day, date, time, activity, supplier, reference, type, pax, flags. Edits are held per row and applied at confirm time. The bar above the table states days, lines recognised, guest names found, pax in force, and lines skipped.

### 5.3 Writes on confirm (per included item with a date)

| Entity | Rule |
|---|---|
| `departures` | upsert on `(operator_id,date,time,product_name)` with `product_name = activity`, `external_id = reference`, `product_id` matched by case-insensitive name if a product exists. Missing time defaults to 09:00 (16:00 for accommodation) and is flagged in the preview. |
| `suppliers` | matched by case-insensitive name for the operator. New: `channel = email`, `product_names = [activity]`, `detail_template = "<activity> for {pax} pax at {time} on {date} (ref X)"`, `confirm_by = "17:00 day before"`. Existing: the activity is appended to `product_names` and the template refreshed, so the planner (`plan-day`) keeps emitting this confirmation whenever the departure is re-planned. |
| `plans` | `supplier_confirmations.plan_id` is NOT NULL, so a draft plan for the date is created if none exists (`generated_by = itinerary-import`). `plan-day` deletes and rebuilds the plan on the next run; the confirmations survive because the supplier now matches the product name. |
| `supplier_confirmations` | one per item with a supplier: `supplier_name`, `detail = "<activity> on <date> at <time>, <pax> pax, ref <X>, <note>"`, `status = pending`, `due_label = "17:00 day before"`. An identical row on the same plan is deleted first, so re-importing does not duplicate. |
| `bookings` | only when the guest block exists: one group booking per departure, `external_ref = ITN-<date>-<ref or activity>`, `source = itinerary`, `lead_name = first guest`, `pax = group pax (else guest count)`, `notes = "Group: <all names>"`. Upsert on `(operator_id,external_ref)`. |
| `audit_log` | `itinerary.imported` with counts and dates. |

Category storage: `suppliers` has no `category` column. The category is expressed in `detail_template` (meal word / "Overnight" / activity) and in the confirmation detail. A `suppliers.category` column is a small follow-up migration; the parser already emits it.

## 6. Acceptance tests

Spreadsheet
1. Load `samples/bookings-sample.xlsx`: sheet "Bookings" is selected (not "Notes"), 11 headers guessed as ref/product/date/time/lead_name/pax/pickup_location/phone/email/source/notes, dates shown as `12/10/2026`.
2. Change one mapping, import: 6 bookings across 3 departures, no errors. Reload the page and the same file: the changed mapping is pre-applied and marked "saved".
3. Load `samples/rezdy-manifest-sample.csv`: still works; the Rezdy headers get their own entries in `import_map` without disturbing the workbook's.
4. Re-import the same file: booking count unchanged (upsert on external_ref).

Itinerary
5. Paste `samples/itinerary-sample.txt` with no start date: 2 days dated 2026-10-12 and 2026-10-13 from the headers, 11 items, group pax 14, 7 guests, 3 skipped lines (title, coach note, drive narration).
6. Categories: Breakfast/Lunch/Dinner rows are `meal`; Skyline Gondola, Adrenaline Forest, Glacier Explorers are `activity`; both Overnight rows are `accommodation`.
7. References: SG-2231, AF-77812, VC-4410, 5566, RR-10921, 5567, TL-301, BH-2210 land in the Reference column; "Lunch at Fergburger" shows `no reference` and note "no booking, pay direct".
8. Times: `7pm` → 19:00, `7.30am` → 07:30, `1830` → 18:30; Overnight rows flagged `no time`.
9. Confirm: 11 departures (external_id = reference), suppliers created once per venue (Rainforest Retreat and Bealey Hotel appear twice in the text but once in `suppliers`), one confirmation per supplier line on the day's plan, one group booking per departure with lead "Wei Ling Tan", pax 14. Success message states the counts.
10. Confirm again: departure, supplier and confirmation counts do not grow.
11. Remove the Guests line and confirm: no bookings are created and the message says so.
12. Paste an itinerary whose headers are `Day 1`, `Day 2` with no dates and leave the start date blank: the confirm button is disabled and the hint says to set the Day 1 date. Set it: dates fill in as start, start+1.

Build
13. `cd app && npm run build` passes.

## 7. Limits and later

- Parsing is regex-based on purpose: it is predictable and works offline. Itineraries written as prose paragraphs, tables pasted from Word with tabs, or times written as "mid-morning" will land in "Skipped lines" and need a manual line. `.docx` upload is not supported; paste the text.
- Guest names create a single group booking per departure, not one booking per guest. Per-guest phone and email are not in an itinerary, so messaging for these bookings runs through the manual/hotel-note path until the operator adds contacts.
- `suppliers.category` column, and surfacing the category on the Day supplier list, is a follow-up migration.
- Optional Claude pass (later): when `ANTHROPIC_API_KEY` is set on the `plan-day` function, an edge function could take the raw text and the deterministic parse and return corrections (`{i, activity, supplier, reference, category}`) for lines the regexes flagged. It would only ever propose edits to the preview; the deterministic parser stays the default and confirm still requires the operator.
