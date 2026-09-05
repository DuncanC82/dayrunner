# Charter mode and supplier confirmations by category

Version 0.1 · 6 September 2026

## Problem

Multi-day tour operators do not own a fleet. They request one vehicle from a coach company ("an eighteen seat Sprinter with a trailer") and expect it, with a driver, for the whole tour. The fleet allocator is the wrong shape for them: there is nothing to allocate, and the driver work-time rules belong to the coach company. What they need from the vehicle is the price, the driver's details, and whether the driver's meals and accommodation are included.

The same operators reconfirm suppliers per category per day, and today they track it in a Gmail folder tree: Meals → each day; Activities → each day (several under one day). The flat per-day supplier list in Day view loses that grouping.

## Evidence

Operator review of the live app, verbatim:

- "Not too sure about this box [allocation]. Generally a tour… we just request a vehicle, so we might request a Sprinter. An eighteen seat Sprinter with a trailer, and we would expect the coach company to provide that for the entire tour. The only thing further that we do with the vehicle is we want to know the price and the driver details and whether or not breakfast and meals are included, and accommodation is included."
- "I'm used to looking at it in a Google inbox where we've got folders for each category for each day. So to break it down into, like, this is going to be the meals section. And within the meals section, we've got each day. The activity section, you've got each day. And then you might have multiple activities under one day."
- "I like that it's got the by-the-day. I like that you can confirm it."

## User stories

1. As a charter operator, I want to record the vehicle I have asked the coach company for (spec, dates, price, driver, inclusions), send that request in my voice, and have the reply update the record, so the Day view shows the right vehicle and driver for every day of the tour without me allocating anything.
2. As a coordinator, I want supplier confirmations grouped by category (Meals, Activities, Accommodation, Transport, Other) and then by day, across the whole tour, so the screen matches the folder tree I run today and I can see at a glance which category still has silent suppliers.

## Scope

### A. Supplier confirmations grouped by category, then day (Day.tsx)

- Groups, in order: Meals (meal_breakfast, meal_lunch, meal_dinner, with the meal shown under the supplier name), Activities (`activity`), Accommodation, Transport, Other. Empty groups are hidden. Each group header shows `confirmed/total`.
- Every row shows its day (`Sat 7 Sep`), supplier, detail, due-by, status, and the existing Send / Draft / Confirmed actions.
- Range toggle: **This day** (default; the selected date only) | **Whole tour (7 days)** (selected date through date+6). The range query is `supplier_confirmations` joined `plans!inner(date)` filtered on `plans.date`, so several days appear under each category. Category comes from `suppliers.category` (joined client-side).
- Send all pending groups the selected rows by `plan_id` and calls `supplier-confirm` once per plan; a row's Send calls it for that row's plan. No change to the edge function.

### B. Charter mode

`operators.settings.ops_mode = 'fleet' | 'charter'` (default fleet). Set in Setup → Operating mode. Rule-style setting, no schema change.

New table `transport_requests`: id, operator_id, tour_id (uuid, nullable, no FK yet), date_from, date_to, supplier_id (nullable, a supplier with category `transport`), vehicle_spec, price, currency (NZD), driver_name, driver_phone, driver_meals_included, driver_accommodation_included, status `pending | requested | confirmed | declined`, notes, message_body, sent_at, reply_text, replied_at. RLS by `is_member(operator_id)`. `suppliers.category` gains a check constraint that includes `transport`.

**Planner (`plan-day`)** when `ops_mode === 'charter'`:

- Skips fleet and roster allocation and every work-time check (5.5h break, 13h day, 10h rest, 70h period, operator max_hours). No `work_log` rows are written. Out-of-service vehicle warnings are suppressed.
- Picks the transport request covering the date (confirmed preferred, then requested, then pending; declined ignored).
- Emits one allocation row per departure: `vehicle_label` = the spec when confirmed, `Requested: <spec>` when not yet confirmed (warn), `No transport requested` when none covers the date (bad). `driver_label` = `<name> · <phone> (charter driver)` when known, else `Driver TBC by coach company`. Price and inclusions go in the note.
- Raises one exception per plan: warn "Transport not confirmed for D" (options: chase / mark confirmed) or bad "No transport requested for D" (options: Request a vehicle / switch to fleet mode).
- Pickups, guest messages, supplier confirmations and other exceptions are unchanged. `plans.summary` gains `ops_mode` and `transport_request_id`.

**Transport section (Day.tsx, charter mode only)**: shows the request covering the selected date (or an empty form defaulting to that date). Fields: vehicle spec, coach company (suppliers with category transport), from/to, notes, price, driver name and phone, meals included, accommodation included, and the last reply. Actions: Save, Request (saves then calls `transport-request`), Confirmed, Draft (show/copy body).

**Edge function `transport-request`** (same pattern as `supplier-confirm`):

- `POST {operator_id, request_id}` (member JWT). Composes a deterministic request (spec, date span with day count, notes, the three questions: price, driver name and mobile, whether meals and accommodation are included; ask to reply "confirmed"). Polished by `claude-sonnet-5` in `operators.voice` when `ANTHROPIC_API_KEY` is set, facts preserved. Sends via Resend when `settings.messaging.resend_key` + `email_from` exist and the coach company has an email; otherwise marks manual. Either way `status -> requested`, `sent_at` set, body stored in `message_body`. Audit `transport.request.sent`.
- `POST ?token=<connectors.webhook_token, kind email> {from, subject, text}`: resolves the operator, matches the sender to a supplier by email (fallback contact), picks that supplier's latest `requested`/`pending` request, stores `reply_text`/`replied_at`, extracts with simple regexes: driver name ("driver is/will be X", "X will be your driver"), NZ mobile, price (`$1,850` / `NZD 1850`), meals and accommodation included / not included. Status becomes `confirmed` on a yes phrase, `declined` on a no phrase, otherwise unchanged. Audit `transport.reply.received`.

### Setup

Operator panel gains an **Operating mode** select (fleet | charter) saved into `operators.settings.ops_mode`, merged with existing settings.

## Out of scope

Linking a request to a tour row (`tour_id` is present for the tours feature to use), per-day vehicle changes within a tour, multiple vehicles per tour, chasing unanswered requests, parsing amended dates or specs out of replies, and driver hours for charter drivers (the coach company's responsibility).

## Acceptance tests

1. Given `ops_mode = charter` and no transport request covering D, when plan-day runs for D, then every allocation row has `vehicle_label = "No transport requested"`, `driver_id`/`vehicle_id` null, status `bad`, and exactly one bad exception "No transport requested for D" with option "Request a vehicle"; no `work_log` rows are written for D; guest messages are held.
2. Given a `pending` request "18-seat Sprinter with trailer" covering D, when plan-day runs, then `vehicle_label = "Requested: 18-seat Sprinter with trailer"`, status `warn`, one warn exception "Transport not confirmed for D".
3. Given that request is `confirmed` with driver "Sam Kereopa" and price 1850, when plan-day runs, then `vehicle_label = "18-seat Sprinter with trailer"`, `driver_label` starts with "Sam Kereopa", the note contains "NZD 1850", status `ok`, no transport exception, and no driver-hours exceptions even if no staff exist.
4. Given `ops_mode = fleet` (or unset), plan-day output is unchanged from before this feature.
5. Given a pending request and no Resend key, when `transport-request` is called, then status becomes `requested`, `sent_at` is set, `message_body` contains the spec, the date span, and the words "price", "driver" and "accommodation", and the response has `sent = "manual"`.
6. Given a `requested` request for a supplier with email `ops@coach.co.nz`, when an inbound POST with that from-address and text "Confirmed. Driver is Sam Kereopa, 021 555 1234, $1,850 all up, meals included, accommodation not included" hits the token URL, then status is `confirmed`, `driver_name = "Sam Kereopa"`, `driver_phone` contains "021 555 1234", `price = 1850`, `driver_meals_included = true`, `driver_accommodation_included = false`.
7. Given the same but text "Sorry we have no availability those dates", status becomes `declined`.
8. Unknown token returns 404; unknown sender returns 200 `{matched: false}` and writes nothing; non-member JWT on the compose path receives 403.
9. In Day view with **This day**, confirmations render under category headers in the order Meals, Activities, Accommodation, Transport, Other; a lunch supplier shows "lunch" under its name; empty categories are hidden.
10. With **Whole tour (7 days)** and plans on D and D+1, the Meals group lists rows for both days with their day labels, and Send all pending sends both days' rows (one `supplier-confirm` call per plan).
11. Setup shows the Operating mode select, saving it writes `settings.ops_mode` without clobbering `settings.messaging`; Day view shows the Transport section only in charter mode.
12. `npm run build` passes.
