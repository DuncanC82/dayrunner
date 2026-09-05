# Feature: Group composition, rooming, and the day sheet in Jackie's order

Status: built (v1) · Owner: Duncan Crawford · 6 September 2026 · Surface: `app/src/pages/Tour.tsx` (Group panel, per-day overview + inclusions), `app/src/pages/Guide.tsx` (tour day sheet), `supabase/migrations/20260906150000_group_composition.sql`, print block appended to `app/src/styles.css`

## 1. Problem

The tour day sheet (tours.md) shows the stops, and nothing else. A tour coach operator's day sheet is a page with a shape: the whole itinerary at the top, a plain-language "today" and "tomorrow", what's included (transport, breakfast, lunch, dinner), then the group — how many adults, how many kids, boys and girls, and how they are roomed — and only then the stops, grouped by kind. We stored `group_pax` as one number, which answers none of the questions a hotel or an activity supplier asks.

## 2. Evidence

Jackie, tour coach operations specialist, reviewing the live app, 6 September 2026 (verbatim):

> "Probably good if it's laid out nicely. They've got the itinerary at the top of the page. So it's like the whole itinerary, and a brief summarisation with the date today, and then just what we're doing next day. It doesn't have to be time-gridded. Just a general overview. And if they need transport and a breakfast voucher, dinner included. And then underneath that, we've got the information about the group. How many adults, how many kids, how many boys, how many girls. What kind of combination are we booking for them? Because they might have four kids. You might be booking some private rooms, or you might have one adult and one child in a hotel room together. It's just a lot of variation. And then we've got the actual subcategories, like accommodation, all listed, and you've got your activities."

Read: (a) the page order is fixed — itinerary, today/tomorrow overview, inclusions, group, then stops by subcategory; (b) overviews are prose, not a time grid; (c) group is a split (adults / children / boys / girls) plus a rooming list with free-text combinations, because the combinations do not fit an enum.

## 3. User stories

1. As a coordinator I can record the group split (adults, children, boys, girls) and group notes on the tour, and see the total against the tour's pax.
2. As a coordinator I can keep a rooming list: rows of `count × room_type (occupants) · notes`, add, edit inline, delete.
3. As a coordinator I can write a one-paragraph overview for each day and tick what is included (transport, breakfast, lunch, dinner).
4. As a driver-guide I open the run sheet for a tour and read, top to bottom: tour name and day N of M, the whole itinerary with today highlighted, today's overview and tomorrow's, the inclusions, the group split and rooming, then the stops grouped Accommodation → Activities → Meals → Transport → Other with GUIDE + DRIVER notes.
5. As a driver-guide I can print that page and get a clean sheet with no navigation or buttons.

## 4. Acceptance tests

- A1 Migration adds `tours.adults|children|boys|girls int not null default 0`, `tours.group_notes text`, `tour_days.inclusions jsonb default '{}'`, `tour_days.overview text`, and table `rooming` with `room_type` constrained to `twin|double|single|triple|family`, RLS `is_member(operator_id)`.
- A2 On the tour page, setting adults 9 and children 5 shows "14 pax"; boys 3 + girls 2 ≤ children shows no warning; boys 4 + girls 2 shows "Boys + girls is more than children."
- A3 "+ room" inserts a `twin × 1`; changing type, count, occupants or notes persists on blur/change; "×" deletes the row; rows render in `sequence` order.
- A4 Ticking "Breakfast" on Day 1 writes `inclusions.breakfast = true` and leaves other keys untouched; the day sheet shows a "Breakfast included" pill for that day.
- A5 `dayOverview(day, stops)` returns `day.overview` when set; otherwise `"<title>: <stop names in sortStops order joined by ', then '>."`; with no stops and no title, "Nothing planned yet."
- A6 Guide, tour mode, date = day 1 of a 2-day tour: the itinerary strip lists both days with day 1 highlighted; the "Tomorrow" card shows day 2's overview; on the last day it says "Last day of the tour."
- A7 Guide stop groups appear in the order Accommodation, Activities, Meals, Transport, Other; empty groups are hidden; each stop is the existing `StopCard` with GUIDE + DRIVER notes only (GROUP/OFFICE never shown).
- A8 No guest names, phones or pickup lists appear anywhere on the tour day sheet.
- A9 Print: the sidebar, date/tour picker, and Driver briefs panel are hidden; the day sheet prints with the today row still highlighted.
- A10 Fleet run sheet (no tour selected) and the Driver briefs panel are unchanged.
- A11 `npm run build` passes.

## 5. Data model

```
tours      + adults int 0, children int 0, boys int 0, girls int 0, group_notes text
rooming    id, operator_id, tour_id, room_type ∈ twin|double|single|triple|family, occupants text, count int 1, notes text, sequence int
tour_days  + inclusions jsonb {} (transport|breakfast|lunch|dinner: bool), overview text
```

`group_pax` stays as the headline number typed at tour creation; the Group panel shows "(tour says N)" when adults + children differs, and the day sheet prefers adults + children when non-zero.

## 6. UI

- **Tour page → Group panel** (above the day columns): four number inputs (adults, children, boys, girls), a group-notes line, and the rooming list — one row per rooming line: count, type select, occupants, notes, ×; "+ room" appends.
- **Tour page → each day column header**: after date / overnight, a two-line overview textarea (placeholder is the generated sentence so the coordinator sees what the guide will get if they leave it blank) and four inclusion checkboxes.
- **Run sheet (Guide), tour mode**, in order:
  1. Eyebrow `Tour · Day N of M`, heading `Mon 12 Oct · <day title>`, then the itinerary strip — one line per day `Day 1 Mon 12 Oct · Queenstown to Franz Josef · overnight Rainforest Retreat`; today in night/hi-vis; clicking a row jumps the date.
  2. Two cards: **Today** (overview, overnight, inclusion pills) and **Tomorrow** (same, or "Last day of the tour.").
  3. **Group** card: `9 adults · 5 children · 3 boys, 2 girls`, rooming lines, group notes.
  4. Stops grouped under Accommodation / Activities / Meals / Transport / Other headings, each a `StopCard` with GUIDE + DRIVER notes.
  A "Print day sheet" button calls `window.print()`; the print block hides chrome.
- Fleet run sheet and Driver briefs: untouched apart from a `no-print` class on the briefs panel.

## 7. Limits / next

- Rooming is free text by design; there is no validation that rooming occupants add up to the group split.
- Inclusions are per day, not per stop; a breakfast voucher for one hotel vs. another is a GUIDE note on the stop.
- Overviews are typed; there is no AI draft of the overview yet (the generated fallback is a stop list, not prose).
- The demo tour "Southern Loop" carries a realistic group (14 pax = 9 adults + 5 children, 7 rooming lines) and day overviews/inclusions.
