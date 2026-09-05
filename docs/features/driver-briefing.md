# Driver briefing

Status: built, not yet committed · Owner: driver-briefing agent · 6 September 2026

## Problem

Every operator we have spoken to briefs drivers and guides the evening before through a WhatsApp group. Someone in the office reads the plan, types out "Sam, you've got the 08:00 Milford in the Sprinter, pickups from 07:15 at Novotel..." for each driver, and pastes it into the group. It is the last thing done each day, it is retyped from a spreadsheet, and when the plan changes at 21:00 the group is where the correction has to go.

DayRunner already drafts every guest message for tomorrow. It had nothing for the staff side.

## Evidence

Verbatim from an operator call, 5 September 2026:

> "You don't communicate to the Gaia talk group, do you? Do you kind of say, 'Hey, your driver is going to be there tomorrow morning'?"

Also from the PRD evidence: Cheeky Kiwi Travel runs "a WhatsApp group created for each day tour"; New Zealand Trails' logistics team "monitor trip chats"; the Nelson operator's administrator "prepares daily schedules for guides and drivers".

## User stories

Coordinator

- After I plan (or re-plan) tomorrow, I can draft one brief per driver-guide and one digest for the whole day with one click.
- Each brief already has everything the driver needs: departures, vehicle, the pickup run with times and names, pax, notes (child seat, dietary, over-hours), supplier stops, and any external alert.
- I read them, fix anything, approve, and they go out with the guest messages from the Day page. No provider configured? I copy and paste into the WhatsApp group.
- If I re-plan, the old briefs are replaced and I am told to re-send.

Driver-guide

- I get one message the evening before with my whole day in it, in the order I will drive it.
- I reply 1 so the office knows I have seen it.
- There is a link to the run sheet on my phone if I want the guest list and phone numbers.

## Message content

Per driver (deterministic template, plain NZ voice, under 700 characters so it fits one WhatsApp bubble and at most five SMS segments):

```
Kia ora Sam, your run for Sat 7 Sep with Remarkables Day Tours:

08:00 Milford Sound Day Tour · Sprinter 1 · 11 pax
Pickups: 07:10 Novotel (Chen ×2, Patel ×4), 07:15 Crowne Plaza (Smith ×2), 07:20 QT (Nguyen ×3)
Notes: Child seat needed: fit one to Sprinner 1 before departure.
Suppliers: Milford Sound Cruise (11 pax, 1 dietary)

Alert: MetService heavy rain warning Fiordland from 04:00.

Run sheet: https://.../#/app/guide
Reply 1 when you've read this.
```

Rules: multiple departures listed in time order; pickup stops in driving order; names are booking lead surnames with pax; notes come from the allocation note; supplier stops come from supplier_confirmations for that departure's product; alert is the plan's external alert. If the body would exceed 700 characters the pickup names are dropped first, then supplier detail, then notes, leaving the times and stops intact. A separate guide (not driving) gets the same brief with the vehicle line reading "with <driver>". A split departure (two vehicles, two drivers) briefs both drivers; the vehicle line reads "Sprinter A + Sprinter B (with Jess)".

Group digest (one message for the whole day, for the staff WhatsApp group):

```
Remarkables Day Tours · Sat 7 Sep · 3 departures · 27 pax

08:00 Milford Sound Day Tour · Sam · Sprinter 1 · 11 pax · first pickup 07:10
09:30 Arrowtown & Wineries · Kiri · Hiace 2 · 8 pax · first pickup 09:00
13:00 Glenorchy Explorer · Sam · Sprinter 1 · 8 pax · first pickup 12:35

Unassigned: 13:00 Glenorchy Explorer needs a driver.
Alert: ...
```

## Channels

- WhatsApp via Twilio to `staff.phone` (channel `whatsapp`), the same path guest messages take through `send-messages`. Twilio falls back to SMS when the operator has no WhatsApp sender configured; the message row's channel stays `whatsapp`.
- Staff with no phone get channel `manual` with the recipient set to their name, so the coordinator copies the text into the group.
- The group digest is always `manual` (recipient "Staff group"). Twilio cannot post into a WhatsApp group; the coordinator pastes it.

## Timing

- Drafted on demand from the Run sheet page ("Draft driver briefs"), normally straight after the plan is approved.
- Re-running `driver-brief` on the same plan deletes the previous unsent briefs (draft/held/approved) for that plan and drafts fresh ones. Sent briefs are kept for the audit trail; a re-plan creates a new plan so old briefs are dropped with the old plan.
- Sending is the existing Day page "Send approved" button, which sends every approved message in the plan, guest and driver together.

## Acknowledgement

- v1: the brief ends with "Reply 1 when you've read this." Inbound replies are not yet captured (two-way WhatsApp is out of scope for v1 per the PRD); the coordinator watches the group.
- Later: the run sheet link becomes a per-driver page with a "Got it" button that writes an acknowledgement row, and the Day page shows who has not acknowledged by 21:00.

## Acceptance tests

1. Demo account, tomorrow planned: "Draft driver briefs" produces one `messages` row per distinct driver/guide in the plan's allocations plus one digest, all `status = 'draft'`, `booking_id null`, label `Driver brief · <name>` / `Driver brief · Staff group`.
2. Every per-driver body is under 700 characters and contains each of that driver's departure times, the vehicle name, every pickup stop time, and the run-sheet link.
3. A driver with no phone gets channel `manual`; a driver with a phone gets `whatsapp` and `recipient = staff.phone`.
4. Re-running the function on the same plan does not duplicate briefs.
5. "Approve all briefs" sets the drafted briefs to `approved`; Day page "Send approved" then sends them via `send-messages` with no code change there.
6. An audit_log row `driver_brief.drafted` is written with the count.
7. Unassigned departures appear in the digest under "Unassigned".

## Files

- `supabase/functions/driver-brief/index.ts` (new)
- `app/src/pages/Guide.tsx` (Driver briefs section)
- `docs/features/driver-briefing.md` (this file)

## Limits

- No inbound acknowledgement capture yet.
- Digest cannot be sent to a WhatsApp group by API; copy and paste.
- Run-sheet link is the shared guide page, not per-driver, and needs `operators.settings.app_url` set; without it the link is a relative `/#/app/guide`.
- Supplier stops are matched to a departure by product name, the same heuristic plan-day uses.
- The group digest is not held to the 700-character cap (it is pasted, not sent by API); on the demo day it runs to ~700.
