# DayRunner — Product Requirements Document

Version 1.0 · 5 September 2026 · Owner: Duncan Crawford

## 1. Problem

Small tour, coach and vehicle-rental operators run on a booking system that owns the inventory and nothing else. Everything around the booking is stitched together by hand: quote follow-up in Woodpecker, guest messages in a WhatsApp CRM, pickup lists in a spreadsheet, guide rosters in a group chat, supplier confirmations by phone, and a contractor writing glue code between them.

Evidence gathered September 2026:

- Epic Campers (NZ campervan rental, Rental Car Manager) needs nine systems plus a developer to run one booking funnel: RCM, Respond.io, Zapier, Google Sheets, Woodpecker, Stripe, SendGrid, Supabase edge functions, and Duncan's time.
- A Nelson tour operator pays $60–70k for an administrator to "manage bookings through FareHarbor, Viator and GetYourGuide" and "prepare daily schedules for guides and drivers".
- Explore Fiordland pays a part-timer to build "daily manifests for pickups".
- Canterbury Trails hires someone to "monitor the office phone for calls from customers, hotels and guides when issues arise".
- Cheeky Kiwi Travel runs "a WhatsApp group created for each day tour".
- New Zealand Trails' logistics team "monitor trip chats, road and weather" and "man our 24/7 emergency phone".
- 48% of ANZ operators name automating operations their top 2026 priority. The average operator runs five disconnected systems. Guide turnover runs 40–60% a year.

No booking platform has shipped day-of operations. Every incumbent AI investment (FareHarbor Agent, Peek Copilot, Yonder, GetYourGuide smart replies) points at selling, not running the day. PaxFlow, the closest competitor, is Bókun-centric, manual-first, has no ANZ presence, and starts at €366 a month with a 2,500-passenger floor.

## 2. Product

DayRunner is the operations layer around a booking system. It connects to the operator's booking system, listens to every booking event, and runs the day.

Core loop, every afternoon for tomorrow:

1. Pull tomorrow's departures and bookings from the connected booking system (or a CSV export).
2. Allocate drivers, guides and vehicles against the roster and constraints: licence class, seat capacity, maximum hours, availability, product qualifications.
3. Sequence the pickup run per vehicle.
4. Draft every guest message (pickup confirmation, time change, weather note) in the operator's voice.
5. List every supplier confirmation due (lunch stop, cruise manifest, tasting, ferry) with its deadline.
6. Raise exceptions: anything the allocator could not solve, or any rule the plan breaks, with options.
7. Wait for the operator to approve. Nothing sends until approved.
8. Send via WhatsApp Business API, SMS fallback, or email fallback. Log every send.
9. On the day, record no-shows and incidents against the booking.

## 3. Users

- Owner-operator or operations coordinator of a tour, shuttle or rental company with 2–60 staff, running 2–25 departures a day in season.
- Driver-guides (read-only run sheet, mark pickups and no-shows).
- Later: suppliers (confirmation links), guests (reply to messages).

## 4. Scope for v1 (today)

In:

- Marketing site with pitch, evidence, pricing, and sign-up.
- Authentication: email and password, magic link, per-operator workspaces with role (owner, coordinator, guide).
- Onboarding wizard: operator profile, timezone, message voice, fleet, staff, rules, suppliers.
- Connectors: Rezdy Supplier API (poll bookings and sessions), FareHarbor webhook receiver plus availabilities fetch, Rental Car Manager adapter scaffold, CSV import for any system.
- Planner: deterministic allocator (seats, licence, hours, availability, product skills, vehicle status), pickup sequencing by stop order, message drafting, supplier list, exception list. Optional Claude layer for narrative and message tone when an API key is present.
- Approval queue: approve, edit, hold, approve-all.
- Messaging providers: Twilio WhatsApp and SMS, generic email via Resend, and a manual "copy and mark sent" fallback so the product works with no provider configured.
- Day view: allocation board, pickup run per vehicle, messages, suppliers, exceptions, no-show and incident log.
- Audit log of every automated action.

Out for v1:

- Automated sending without approval.
- Two-way inbound WhatsApp conversation handling.
- Bókun app (PaxFlow owns that door; revisit after FareHarbor and Rezdy).
- Rate management, quoting, payments (Epic's funnel layer is a later module).
- Native mobile app for guides (responsive web is enough).

## 5. Architecture

- Frontend: Vite, React, TypeScript, React Router. Hosted on GitHub Pages under the `dayrunner` repo, custom domain later.
- Backend: Supabase project `PROD-DayRunner` (ap-southeast-2, Sydney). Postgres with row-level security per operator, Supabase Auth, Edge Functions (Deno).
- Edge functions: `rezdy-sync`, `fareharbor-webhook`, `fareharbor-sync`, `rcm-sync`, `plan-day`, `send-messages`, `import-csv`.
- Secrets held in Supabase: `ANTHROPIC_API_KEY` (optional), per-operator provider credentials encrypted at rest in `connector_credentials`.
- Data retention: guest personal data purged 14 days after the departure date, in line with Rezdy's "reasonable period" API terms.

### Data model

- `operators` (id, name, timezone, voice, settings)
- `memberships` (user_id, operator_id, role)
- `connectors` (operator_id, kind: rezdy | fareharbor | rcm | csv, config, status, last_sync)
- `staff` (operator_id, name, phone, licence_class, p_endorsement, max_hours, skills[], notes, active)
- `staff_availability` (staff_id, date, available_from, available_to)
- `vehicles` (operator_id, name, seats, licence_required, status, features[], notes)
- `products` (operator_id, external_id, name, duration_minutes, skills_required[], default_pickup_lead_minutes)
- `suppliers` (operator_id, name, channel, contact, products[], confirm_by_rule)
- `rules` (operator_id, key, value) e.g. break_minutes, pickup_lead_minutes, child_seat_age
- `departures` (operator_id, product_id, date, time, external_id, status)
- `bookings` (operator_id, departure_id, external_ref, source, lead_name, pax, phone, email, pickup_location, notes, status, raw)
- `plans` (operator_id, date, status: draft | approved | sent, generated_by, summary)
- `allocations` (plan_id, departure_id, vehicle_id, driver_id, guide_id, pickup_sequence jsonb, status, note)
- `messages` (plan_id, booking_id, channel, to, body, status: draft | held | approved | sent | failed, sent_at, provider_ref)
- `supplier_confirmations` (plan_id, supplier_id, detail, due_at, status)
- `exceptions` (plan_id, level, title, detail, options jsonb, resolved)
- `incidents` (operator_id, departure_id, booking_id, kind: no_show | incident | note, detail, created_by)
- `audit_log` (operator_id, actor, action, entity, entity_id, detail)

## 6. Planner specification

Input: departures with bookings for date D, staff with availability for D, vehicles with status, products, rules, suppliers.

Algorithm:

1. For each departure, compute pax and required seats (child seats flagged), required skills, duration and hours window.
2. Sort departures by start time, longest duration first within a time.
3. Candidate vehicles: status ok, seats ≥ pax, features satisfy flags. Prefer smallest sufficient vehicle. If none fits, try splitting across two vehicles if two are free; else raise a "vehicle short" exception with options (hire, split, move guests).
4. Candidate drivers: available for the window, licence ≥ vehicle requirement, P endorsement, hours remaining ≥ duration + breaks, skills cover product. Prefer least-loaded, then most experienced on product. If none, raise "driver short" with options.
5. Guide: driver doubles as guide unless product requires a separate guide.
6. Pickup sequence: order bookings by pickup location using the operator's stop order list; assign times back from departure using lead minutes.
7. Messages: one per booking with a phone or email; OTA bookings with no contact get an email plus a hotel note and a HOLD.
8. Suppliers: for each supplier matching the product, emit a confirmation with numbers and the due time from its rule.
9. Exceptions: every unsolved step, every rule breach (hours, licence), data quality issues (unknown product, missing pickup), and external alerts entered by the operator (weather, road).

Optional Claude pass: rewrite messages in the operator's voice, write exception narratives with options, and summarise the day. Never changes allocations.

## 7. Messaging

- Utility-category WhatsApp templates: pickup confirmation, time change, cancellation, weather note.
- SMS fallback via Twilio when no WhatsApp opt-in or delivery fails.
- Email fallback via Resend for OTA bookings with relay addresses.
- Manual fallback: message shown with a copy button and a "mark sent" action, so operators without a provider can still run the day.
- Opt-in recorded per booking (source, timestamp). Operational messages only, no marketing, to stay inside NZ Unsolicited Electronic Messages Act and Meta's utility category.

## 8. Connectors

Rezdy (first): Supplier API key per operator (Expansion plan). Poll `GET /bookings?updatedSince` and `GET /availability` for sessions, `GET /resources`. Webhooks NEW_ORDER, UPDATED_ORDER, CANCELLED_ORDER registered by the operator in Rezdy UI pointing at our endpoint. Write-back: `PUT /manifest/checkinorderitem` for no-shows, `PUT /bookings/{ref}` comments.

FareHarbor (second): Software Partner application filed. Webhook receiver accepts the full booking JSON. Sync via `GET /availabilities/{pk}/bookings/`. Write-back: crew-members POST, check-in PUT, note PUT.

Rental Car Manager (third): adapter scaffold using the Booking API v3 pattern (apikey header, rcmAvailableCars, reservations export). Locked to real field names against Epic's sandbox as a Provider IP component licensed into Epic.

CSV: any manifest export. Column mapping saved per operator.

## 9. Pricing

- Solo: $149/month per depot, up to 5 departures a day.
- Team: $299/month per depot, unlimited departures, WhatsApp included up to 2,000 messages.
- Multi-depot: $249/month per additional depot.
- Founding partners: free until 31 December 2026 in exchange for weekly feedback.

## 10. Success criteria

- Three design partners running a real day through DayRunner by 30 September 2026.
- One partner lets DayRunner send approved messages directly by 31 October 2026.
- Time to plan a day under 5 minutes from manifest to approved plan.

## 11. Risks

- Operators may not trust an agent to send rather than draft. Mitigation: approval queue is the product until trust is earned.
- FareHarbor partner approval takes weeks. Mitigation: CSV import and Rezdy first.
- PaxFlow enters ANZ. Mitigation: AI allocation and exception handling they do not have; FareHarbor and Rezdy first, where they are absent.
- Meta's 1 October 2026 pricing change makes in-window replies billable. Mitigation: utility templates only, pass-through pricing.
- Epic IP: build the generic connector as a separate package before the Fixed Build Fee is paid in full.
