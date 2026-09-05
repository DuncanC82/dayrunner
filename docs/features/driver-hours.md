# Driver work-time compliance and mileage

Status: built, deployed to `plan-day` v3 · 6 September 2026 · Owner: DayRunner PM (driver hours)

## 1. Problem

The planner had one fatigue check: a per-driver `max_hours` number typed into Setup, compared against tour duration plus a fixed 30-minute "break" per five hours. It ignored the pickup run, prep time, work done earlier in the day, and everything before today. It did not know the law, so it could not tell an operator *which* rule a plan broke or what to do about it. It also had no idea how far anyone drove, so there was nothing to reconcile fuel, RUC or driver pay against.

Operators subject to the Land Transport Rule: Work Time and Logbooks 2007 are personally liable for a driver exceeding work time. The coordinator building tomorrow in a spreadsheet at 4pm is the only line of defence, and they are doing it by feel.

## 2. Evidence

Verbatim from an operator call (September 2026), asked what their previous scheduler did:

> "Well, what did Pablo use? Op centre. They did all that: the centre, the driver, but it was just the bookings, right? Op centre was a scheduler, so you entered the information, and you could use it to schedule the jobs. Does it calculate the mileage, the driver hours, and all that kind of stuff? Op centre did."

Their bookings live in Excel; drivers are briefed in a WhatsApp group. "Driver hours and mileage" is the bar a replacement has to clear, named unprompted.

## 3. User story

As the operations coordinator, when I press *Plan the day*, I want every driver's work time for tomorrow computed the way an NZTA inspector would count it (pickups, prep and guiding included, breaks inserted where the law requires), so that the plan tells me *before* I brief the WhatsApp group that Tane's Milford day is 13.3 hours and what my options are. I also want the kilometres per run so I can pay drivers and reconcile fuel without a second spreadsheet.

## 4. Research: the rules

Primary source is the Land Transport Rule: Work Time and Logbooks 2007 (made under the Land Transport Act 1998, Part 4B, s 30ZC "Limits on work time"), summarised by NZTA at [Work-time and logbook requirements](https://www.nzta.govt.nz/commercial-driving/commercial-safety/work-time-and-logbook-requirements) and the [Work Time and Logbooks 2007 Q&A](https://www.nzta.govt.nz/resources/rules/work-time-and-logbooks-2007-qa). Numbers cross-checked against the [Fortune Manning summary of the Rule](https://fortunemanning.co.nz/wp-content/uploads/2019/12/2-Work-Time-and-Logbooks.pdf) and [logmate's plain-English guide](https://help.logmate.co.nz/en/articles/3348318-understanding-the-nz-work-time-rules).

### 4.1 Limits

| Rule | Limit | How DayRunner treats it |
|---|---|---|
| Continuous work | Max 5.5 hours, then a rest break of at least 30 minutes | Encoded. Break inserted inside the run (a lunch stop), does not extend the day. |
| Cumulative work day | Max 13 hours work time in a 24-hour work day | Encoded, hard stop (`bad` exception). |
| Continuous rest | At least 10 hours continuous rest in every 24-hour work day | Not yet encoded: we do not know yesterday's finish time. Flagged as a gap (see 9). |
| Cumulative work period | Max 70 hours work time between 24-hour rest breaks | Encoded as a warning from the work log over the previous 13 days. |
| Ferry | A ferry crossing over 1 hour counts as rest | Not encoded (no ferry products yet). |
| Small passenger service short fares | 7 hours before the break instead of 5.5, only for single fares under 100 km around a town | Not encoded: tour and shuttle runs are not short fares. |

### 4.2 Who is in scope

Work-time and logbook rules apply to a driver of any vehicle that requires a class 2, 3, 4 or 5 licence; any vehicle used in a transport service other than a rental service (this is every passenger service, so every tour operator and shuttle, regardless of vehicle size); any vehicle that ought to be operated under a transport service licence; and any goods vehicle carrying for hire or reward. Carrying passengers for hire or reward requires a passenger (P) endorsement, and a P endorsement is required to drive a large passenger service vehicle (more than 12 seats) even unpaid. The well-known 50 km/class 1-2 exemption applies only to goods vehicles not used for hire or reward, so it does not help a tour operator.

Practical reading for DayRunner customers: a 7-seat Highlander driven by a P-endorsed driver-guide on a paid tour is under the Rule exactly as a 45-seat coach is. The `worktime_regime = none` rule exists for the rare operator outside scope (a rental company moving its own fleet, a volunteer service), not as an opt-out.

### 4.3 What counts as work time

The Rule defines work time as all time spent driving, loading and unloading, vehicle maintenance and cleaning (unless unpaid and outside hours), administration and recording, and *any paid employment of any kind* except paid leave and breaks of at least 30 minutes. Rest time must be at least 30 minutes and not in a moving vehicle associated with work.

So for a driver-guide the whole shift is work: pre-trip check, the pickup run, driving, the guided walk, the cruise the guide sits through with the group, the return run and the depot tidy-up. Breaks only count when the driver is genuinely off for 30 continuous minutes. Guiding while another person drives is still work for the guide. This is what the planner encodes.

### 4.4 2019–2026 changes

- Land Transport Rule: Work Time in Large Passenger Service Vehicles 2019 added 10-minute rest breaks for LPSV drivers (Employment Relations Act break entitlements) and let operators shift those breaks when a service would be disrupted. It did not change the 5.5/13/70 limits ([NZTA](https://nzta.govt.nz/commercial-driving/law-changes-what-you-need-to-know/land-transport-rule-work-time-in-large-passenger-service-vehicles-2019)). Not encoded: 10-minute breaks are employment law, not work-time law, and do not reduce work time.
- Land Transport Rule: Regulatory Systems Rule Amendment 2025 (consulted April–June 2025, in force 3 November 2025) made 36 minor changes across nine rules; nothing found that alters work-time limits ([NZTA consultation](https://nzta.govt.nz/about-us/public-consultation-hub/past-consultations/land-transport-rule-regulatory-systems-rule-amendment-rsra-2025)).
- Electronic logbooks remain permitted only when NZTA-approved ([NZTA](https://www.nzta.govt.nz/commercial-driving/commercial-safety/work-time-and-logbook-requirements/electronic-driver-logbooks)). DayRunner is a planner, not an approved logbook; the `work_log` table is a planning ledger and must not be presented as the legal record.
- No 2026 amendment to the 2007 Rule was found. Tour operators running set multi-day routes can apply to NZTA for a work-time variation; the planner does not model variations.

## 5. Rules encoded

Constants in `supabase/functions/plan-day/index.ts` (`WT`): CONTINUOUS 330 min, BREAK 30 min, DAY 780 min, PERIOD 4200 min over a 14-day window.

Per departure the planner computes a work window for whoever runs it:

```
shiftStart = firstPickupTime − prep_minutes        (or departure time − prep if no pickups)
shiftEnd   = departure time + product duration + prep_minutes
```

`prep_minutes` defaults to 15 (rule key `prep_minutes`). The pickup run is already sequenced from the operator's stop order (lead minutes plus 5 minutes per extra stop), so it is included automatically.

For each candidate driver the planner walks that window against the driver's ledger:

1. Ledger starts at `staff.prior_work_minutes_today` (work done before the plan starts, e.g. an 05:00 airport run) and carries continuous-work across back-to-back departures unless there was a gap of at least 30 minutes.
2. Whenever continuous work reaches 330 minutes, a 30-minute break is inserted at that clock time and continuous resets. Breaks reduce `work_minutes`, not the window.
3. Candidate ordering: skills match first, then least work today. The first candidate who stays within `min(13h, staff.max_hours)` is chosen. If none can, the least-loaded driver is chosen and a `bad` exception is raised naming the Rule, the window, the breaks and the options.
4. `staff.max_hours` is retained as an operator policy limit; exceeding it below 13h raises a `warn`, not a `bad`.
5. A separate guide goes through the same ledger (guiding is work).
6. 70h: `work_log.minutes_work` summed over the 13 days before the plan date plus today's planned total; over 4200 raises one `warn` per driver, because the ledger cannot see a 24-hour break that would reset the period.
7. Mileage per allocation: `stops × km_per_stop` (rule key, default 4) plus `departures.route_km`, falling back to `products.route_km`, else 0.
8. On persist, each driver's planned minutes and km for the date are upserted into `work_log` with `source = 'plan'` (replaced on every re-plan) so later days see them.
9. Rule key `worktime_regime`: `logbook` (default) enforces the 13h and 70h checks; `none` keeps only the operator `max_hours` policy and still computes breaks and km.

Exception shape is unchanged: `{ level, title, detail, options }`.

## 6. Acceptance tests

Run against the sample operator (Remarkables Day Tours), 4 departures, 38 pax.

| # | Scenario | Expected | Result (6 Sep 2026) |
|---|---|---|---|
| 1 | Milford Sound Coach & Cruise, 06:45, 780 min, 4 pickup stops | Window 05:40–20:00, breaks after 11:10 and 17:10, work 800 min, `bad` "over the 13h work day" naming the Rule | Pass (Tane and Jess, split across two Sprinters) |
| 2 | Glenorchy Half Day 13:30 with Moana available from 12:00 | Window starts 12:35, one break at 17:35, 340 min, no legal exception | Pass |
| 3 | Arrowtown & Wine Trail 13:00 with Rob (max_hours 8) | 325 min, no breaks, no exception | Pass |
| 4 | `allocations.km`, `work_minutes`, `breaks` written | Present on every allocation with a driver | Pass (604 / 111 / 80 / 107 km with route_km set on the demo products) |
| 5 | `work_log` rows with `source = 'plan'` | One per driver, minutes match allocations | Pass (4 rows) |
| 6 | Tane has 65h logged over the previous 5 days | `warn` "passes 70h in the cumulative work period" with the figures | Pass ("65.0h in the last 13 days; tomorrow adds 13.3h = 78.3h"); test rows removed afterwards |
| 7 | `worktime_regime = none` | No 13h/70h exceptions; km and breaks still computed | Not run against the demo (would change its rules); logic is a single guard |
| 8 | Driver with `prior_work_minutes_today = 300` on a 5h run | Break inserted 30 min into the run; day total includes the 300 | Unit-level reasoning only |
| 9 | Frontend | `npm run build` clean; `deno check` clean | Pass |

## 7. Data model changes

Migration `supabase/migrations/20260906120000_driver_hours.sql` (applied to `tylttoheoazyvbuixrrk` as `driver_hours`):

- `staff.prior_work_minutes_today integer not null default 0`
- `work_log (id, operator_id, staff_id, date, minutes_work, minutes_drive, km, source, created_at)`, unique on `(staff_id, date, source)`, RLS `is_member(operator_id)`
- `departures.route_km numeric`, `products.route_km numeric`
- `allocations.km numeric`, `allocations.work_minutes integer`, `allocations.breaks jsonb default '[]'` as `[{ after: "HH:MM", minutes: 30 }]`
- `plans.summary` gains `km`, `work_hours`, `worktime_regime`
- Rule keys (no schema change): `worktime_regime`, `km_per_stop`, `prep_minutes`

`minutes_drive` is written as 0 by the planner; it is reserved for an import from an approved electronic logbook.

## 8. UI changes

- `app/src/pages/Setup.tsx`: Products table gains *Route km (return)*; Driver-guides table gains *Hours already worked (min)* and renames *Max hours* to *Max hours (policy)*, with a one-line note on the Rule and the `worktime_regime` switch.
- `app/src/pages/Guide.tsx`: each run shows `Work time 13h20 · 604 km · 30 min break after 11:10, 17:10`.
- `app/src/pages/Day.tsx` (owned by another agent, not edited): the allocation board should show `work_minutes` as h:mm and `km` per row, render `breaks` as pills on the pickup timeline, and put `summary.work_hours` and `summary.km` in the day header next to pax. Exceptions already render with the new detail text.

## 9. Known gaps

- 10-hour continuous rest is not checked because the ledger has no finish time for the previous day. Adding `work_log.finish_time` (written from the plan's last `shiftEnd`) closes this.
- The 70h check cannot see a 24-hour break, so it warns rather than blocks. A `work_log` row with `source = 'rest24'` could reset the window.
- `km_per_stop` is a flat estimate; when the operator has stop coordinates the pickup run can be routed properly.
- The sample loader in `app/src/lib/sample.ts` does not set `route_km`; the demo account was updated directly (Milford 580, Glenorchy 95, Wine 60).
