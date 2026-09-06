---
name: dayrunner-outreach
description: Draft, personalise and track DayRunner pilot outreach to NZ tour and shuttle operators. Use when asked to write an outreach email, call script, follow-up, LinkedIn or WhatsApp message to an operator, prepare a batch from the lead list, or update outreach status.
---

# DayRunner outreach

Voice: Duncan's email-toolkit rules apply (warm, relational, short, never "hope this finds you well", one ask, specific subject line, no pitch-first). This skill adds the DayRunner-specific content.

## Before drafting, read
- docs/outreach/strategy.md (positioning, sequence, objections, pilot offer)
- docs/outreach/time-savings-model.md (the only numbers allowed, all labelled estimates until measured)
- docs/leads/nz-leads-2026-09-06.csv (the lead's row: type, platform, fleet_signal, pain_signal, contact)
- docs/competitors/automate-travel.md if the prospect mentions another tool

## Rules
1. **Lead with their world.** First line is about them: their job ad, their departure count, a review, a cruise day. Pull it from pain_signal and source_url. Never open with DayRunner.
2. **One line on the product, in the coordinator frame.** "Tomorrow's day, decided by 5pm." Never "operations layer", "platform", "AI-powered".
3. **Numbers only from the model, labelled.** "about 15 hours a week for a fleet your size (estimate)". No unsourced ROI.
4. **One ask.** Email 1 and 2: a 20-minute call. Email 3: yes or no on the pilot. Never two asks.
5. **Length.** Email 1 under 120 words. Follow-ups under 80. WhatsApp two sentences. Call script one page.
6. **Platform-aware.** Rezdy: mention Expansion plan needed for sync, CSV otherwise. FareHarbor: pilot on CSV, partnership applied with their name. Checkfront or Bókun: "connects in an afternoon". In-house or unknown: weekly CSV, five minutes.
7. **Segment-aware hook** from strategy.md: own-fleet, charter multi-day, cruise surge, weather shuttles.
8. **Video links.** Email 1 gets the 45-second cut; email 2 the 2.5-minute cut. Placeholder `{{VIDEO_45}}` and `{{VIDEO_150}}` until recorded.
9. **Never send.** Draft only. Duncan sends. Save drafts to comms/outreach/YYYY-MM-DD_Company_step.md.
10. **Personal data.** Use only the business contact in the CSV. Do not look up personal emails or phones.

## Steps for "prepare this week's batch"
1. Filter the CSV to the requested tier (priority >= 5 is Tier 1) and status new.
2. For each, write email 1 and the call opener, using the segment hook and the pain signal.
3. Output a table: company, contact, channel, subject, first line, next_touch date.
4. Append status=emailed and next_touch to the CSV only when Duncan confirms he sent.

## Steps for "follow up with X"
1. Find the last draft in comms/outreach for X and the CSV row.
2. Pick the next step in the 21-day sequence from strategy.md.
3. Reply in-thread (same subject, "Re:"), reference the specific thing from email 1, add one new element (metric, video, pilot terms), same or narrower ask.

## Steps for "call script for X"
One page: their baseline questions (who does the 5pm job, how long, what tools), the demo path for their segment, the pilot offer with price, the two most likely objections from strategy.md with answers.

## Email 1 skeleton
Subject: {their thing} and tomorrow's run sheet
{Observation about them, one sentence.}
{What that usually means at 5pm, one sentence, in their words.}
I built DayRunner to do that job: it pulls tomorrow's bookings, allocates vans and drivers within the work-time rules, drafts the pickup messages, and chases the suppliers from your own Gmail. You approve, it moves on. 45 seconds: {{VIDEO_45}}
Worth 20 minutes this week to see it on your bookings?
Duncan

## Done means
Draft saved, table returned, no message sent, CSV untouched until Duncan confirms.
