# Feature: Tours — the whole-tour view, itinerary-grade stops, audience-tagged notes

Status: built (v1) · Owner: Duncan Crawford · 6 September 2026 · Surface: `app/src/pages/Tour.tsx`, `app/src/pages/Guide.tsx`, `app/src/lib/itinerary.ts` (`tourFromItinerary`), `supabase/migrations/20260906130000_tours.sql`

## 1. Problem

DayRunner's unit of work is a date: pull tomorrow's departures, allocate vehicles, message guests. That is right for a day-tour operator and wrong for a multi-day tour operator. For them the unit is the **tour**: one group, on the coach for the whole trip, moving through a sequence of stops that each have a supplier, an address, a phone number, a booking reference, a blurb and a set of notes aimed at different people. The Day page showed them a fleet run sheet full of guest names and no-show buttons; their run sheet is an itinerary with a lot more detail on each stop and nothing about the people.

## 2. Evidence

Multi-day tour operator reviewing the live app, September 2026 (verbatim):

> "I couldn't load a run sheet or anything, so I don't know if there's a way to change it to, like, the whole tour view… the whole tour view is quite useful."

> "If I show you an itinerary… Skyline Gondola is in blue. The address and phone number is in black underneath, and then you've got the booking reference in orange underneath that. And then you've got the blurb about the activity. And then underneath that, you've got any special notes, and it depends who they're for as to what colour they code it. The guide might need notes to say check in twenty minutes prior or pick up tickets… use entrance G… Remind the group to not pack their sweaty togs in the checked luggage."

> "That should be a run sheet for the day… we need to put more detail in, a lot more detail."

> "I don't need to know about the people."

> "On the day guests… I don't need that at all… everyone on the tour is on the tour the entire tour. That would only be day one… where is this person and how are we getting him here?"

Read: (a) the tour, not the date, is the frame; (b) each stop is a card with a fixed visual grammar — name, address/phone, reference, blurb, colour-coded notes by audience; (c) guest detail matters once, on day 1 (arrivals), and never again.

## 3. User stories

1. As a coordinator I can create a tour (name, dates, group pax) and see all its days side by side, each day a column of stops in time order.
2. As a coordinator I can add a stop inline (time, name, category, address, phone, reference, blurb) and add notes to it tagged GUIDE, GROUP, DRIVER or OFFICE, and edit or delete either.
3. As a coordinator pasting an itinerary on Import, I can tick "Create as a tour" and get a tour with one tour day per itinerary day and one stop per line, categories and references carried across, in addition to the existing departures/suppliers/confirmations.
4. As a driver-guide on the Run sheet page I can pick a tour and see today's stops with address, phone, reference, blurb and the GUIDE and DRIVER notes only — no guest names, phones or pickup lists.
5. On day 1 of a tour the coordinator sees an arrivals panel: bookings on that day's departures with pickup location, phone and notes, so "where is this person and how are we getting him here" is answered once.

## 4. Acceptance tests

- A1 Creating a tour with start 12 Oct and end 13 Oct produces two `tour_days` (day_number 1, 2 with the right dates).
- A2 Adding a stop at 08:30 then one at 07:00 renders 07:00 first; a stop with no time sorts after timed stops by `sequence`.
- A3 A note added with audience `group` renders with a GROUP tag on the tour page and does **not** appear on the Guide run sheet; `guide` and `driver` notes do.
- A4 `tourFromItinerary(parse, opts)` on `samples/itinerary-sample.txt` yields 2 days and 11 stops (the untimed "Drive via Haast Pass" line is skipped as noise); `meal` items map to `meal_breakfast|meal_lunch|meal_dinner` by the meal word, `accommodation` to `accommodation`; each stop's `reference` equals the parsed reference.
- A5 Import with "Create as a tour" ticked writes tours/tour_days/stops and sets `departures.tour_id`/`tour_day_id` on the departures it upserts; unticked leaves those tables untouched.
- A6 Day 1 arrivals lists bookings whose `departure_id` is on a departure with `tour_day_id` = day 1; with none it shows an empty prompt rather than nothing.
- A7 RLS: a user who is not a member of the operator cannot select or insert any of the four tables.
- A8 `npm run build` passes.

## 5. Data model

```
tours       id, operator_id, name, start_date, end_date, group_pax, status(draft|confirmed|running|done|cancelled), notes, created_at
tour_days   id, tour_id, operator_id, date, day_number, title, overnight_location          unique(tour_id, day_number)
stops       id, operator_id, tour_id, tour_day_id, departure_id?, time?, name, category, supplier_id?, address, phone, reference, blurb, sequence
            category ∈ activity | meal_breakfast | meal_lunch | meal_dinner | accommodation | transport | other
stop_notes  id, stop_id, operator_id, audience ∈ guide|group|office|driver, body, created_at
departures  + tour_id?, tour_day_id?   (nullable FKs so an existing day plan hangs off a tour day)
```

RLS: `is_member(operator_id)` for all on every new table. Cascades: deleting a tour removes its days, stops and notes; deleting a departure or supplier nulls the stop's link.

Ordering rule: `time asc nulls last, sequence asc`. `sequence` is the line order at import time and the insertion order for manual adds.

## 6. UI

- **/app/tours** — list of tours (name, dates, days, pax, status) + "New tour" form (name, start, end, pax). Creating a tour creates its days.
- **/app/tours/:id** — the whole-tour view. Header: name, dates, pax, status, tour notes. One column per day (`grid-template-columns: repeat(auto-fit, minmax(300px, 1fr))`, stacks on mobile). Day column header: "Day n · date · title", overnight location. Stops as itinerary cards:
  - name — bold, accent (`--link` blue)
  - address · phone — plain ink
  - reference — mono tag, orange (`--check` amber on `--check-bg`)
  - blurb — body text
  - notes grouped by audience, each with a small tag: GUIDE (navy/hi-vis), GROUP (teal), DRIVER (amber), OFFICE (grey)
  - inline edit (click "Edit") and "+ note" per card; "+ stop" at the foot of each day.
- **Day 1 arrivals** panel at the top of the day-1 column: bookings on that day's departures with lead name, pax, pickup location, phone, notes. Empty prompt when there are none. This replaces the no-show list for tours (no-shows stay on the Day page for day-tour operators).
- **Run sheet (Guide)** — tour selector next to the date. With a tour selected, the fleet run sheet is replaced by the itinerary-grade day sheet for the selected date: stops with address/phone/reference/blurb and GUIDE + DRIVER notes only. The Driver briefs panel is unchanged.
- **Import → Itinerary** — checkbox "Create as a tour" (default on). Tour name from the first line of the paste (or "Imported tour"); days from the parse; stops from every ready item; departures get `tour_id`/`tour_day_id`.

## 7. Limits / next

- No drag reorder; ordering is by time then sequence.
- Addresses and phones are not looked up; they are typed or come from the supplier record when a stop is linked to a supplier (v1 links by name match at import only).
- Group notes are not yet sent to guests; that is the messaging feature's job once it reads `stop_notes` where `audience = 'group'`.
- A tour spans one operator; there is no sharing with a supplier or a client.
