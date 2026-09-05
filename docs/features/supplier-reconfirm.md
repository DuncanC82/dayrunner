# Supplier reconfirmation

Version 0.1 · 6 September 2026

## Problem

The day before a tour, the coordinator reconfirms every supplier the itinerary touches: activity operators (Glacier Explorers, Adrenaline Forest, Skyline Gondola), meal stops (breakfast, lunch, dinner), transport (ferry, water taxi, coach subcontractor) and accommodation. Today this is done by phone or by hand-typed email, one supplier at a time. The itinerary already holds every fact needed (date, time, product, pax, dietary flags). The operator's own words are the bottleneck, not the data, and replies land in an inbox nobody tracks against the plan.

## Evidence

Operator call, verbatim: "can you reconfirm the details of trips to suppliers, like operators like Glacier Explorers and everything? I don't like the way I sound. I could probably just get the audio and put it into Activity Suppliers, like Glacier Explorers, Adrenaline Forest, or Skyline Gondola, and Meals Restaurants for breakfast, lunch, and dinner."

Three things in that quote: (1) reconfirmation is a per-supplier chore repeated daily; (2) the operator dislikes writing the message ("I don't like the way I sound"); (3) suppliers group naturally into activity and meal categories, and the operator already thinks of them that way.

## User story

As the coordinator, once tomorrow's plan is generated I want every supplier confirmation drafted in my voice with the right numbers, sent with one click (or copied if I have no email provider), and I want to see at a glance which suppliers have replied and which are still silent, so that I never phone a restaurant twice and never turn up with 14 pax against a booking for 10.

## Scope

### Supplier categories (`suppliers.category`)

| category | examples | template emphasis |
|---|---|---|
| `activity` | Glacier Explorers, Adrenaline Forest, Skyline Gondola | arrival time, pax, product |
| `meal_breakfast` / `meal_lunch` / `meal_dinner` | cafes, restaurants, lodges | pax, dietary count, arrival time |
| `transport` | ferries, water taxis, subcontract coaches | pax, departure time, vehicle |
| `accommodation` | hotels, lodges | pax, rooming, arrival |
| `other` | anything else | generic |

Category drives the subject line and the second sentence of the template. Each supplier also gets `suppliers.email`, separate from the free-text `contact` field, so sending and reply-matching have a clean address.

### Confirmation template (deterministic)

Composed per `supplier_confirmation` row, in this order:

1. Greeting: `Kia ora {supplier name} team,`
2. Fact line: `Reconfirming for {weekday d Month}: {detail}` where `detail` is the planner's rendered `detail_template` (already includes pax, product, time, dietary count).
3. Category line (see table above), e.g. for meals `Please let us know if the numbers above cause any issues with the kitchen.`
4. Ask: `Could you reply with a quick "confirmed" so we can close it off our side?`
5. Sign-off: `Ngā mihi,\n{operator name}`

Facts come only from the plan. If `ANTHROPIC_API_KEY` is set the body is optionally polished by `claude-sonnet-5` using `operators.voice`, with the instruction that every number, time, date and name must be preserved and the word "confirmed" must stay in the ask. Any failure of the polish step falls back to the deterministic body. The body is stored in `supplier_confirmations.message_body` whether or not it was sent, so the operator can copy it.

### Sending

`POST /functions/v1/supplier-confirm` with `{operator_id, plan_id, confirmation_ids?}` (member JWT).

- If `operators.settings.messaging.resend_key` and `email_from` exist and the supplier has an email: send via Resend, subject `{operator}: reconfirming {category label} for {date}`, `reply_to` set to the operator's `email_from`. `status` -> `sent`, `sent_at` set.
- Otherwise: `status` -> `sent_manual`, `sent_at` set, body in `message_body`; UI shows a Copy button. Operators with no provider still get the drafting benefit.
- Every call writes one `audit_log` row `supplier.confirmations.sent`.
- Rows already `confirmed` are skipped.

### Reply tracking model

`supplier_confirmations` gains `sent_at`, `message_body`, `reply_text`, `replied_at`.

Status lifecycle: `pending` | `hold` -> `sent` | `sent_manual` -> `confirmed` (or `replied` when a reply arrived but did not read as a yes). The coordinator can always force `confirmed` by hand.

Inbound: `POST /functions/v1/supplier-confirm?token=<connectors.webhook_token>` where the connector has `kind = 'email'`. Body `{from, subject, text}` (the shape an inbound-email relay such as Resend inbound, Postmark or a Zapier mail parser posts). The function:

1. Resolves the operator from the token.
2. Normalises `from` to a bare address and finds the supplier with that `email` (fallback: `contact` contains the address).
3. Picks the most recent confirmation for that supplier with status in (`sent`, `sent_manual`, `pending`, `replied`), ordered by `sent_at` desc.
4. Stores `reply_text`, `replied_at`. If the text matches `/\b(confirm(ed)?|yes|all good|sweet as|no problem|booked)\b/i` the status becomes `confirmed`; otherwise `replied`, which the UI renders as CHECK so a human reads it.
5. Audit `supplier.reply.received`.

### Voice

`operators.voice` is the same free-text field the guest messages use. Suppliers are trade partners so the polish prompt is told to keep the tone "warm but brief, trade-to-trade". No new setting.

## Out of scope

Phone reconfirmations, SMS to suppliers, reminders when no reply by the due time (a follow-up; the data to do it is now present), and parsing amended numbers out of replies.

## Acceptance tests

1. Given a plan with two supplier confirmations and no Resend key, when the coordinator clicks Send all pending, then both rows have `status = sent_manual`, `sent_at` set, and a `message_body` that contains the pax count and product from `detail`.
2. Given `operators.settings.messaging.resend_key` and `email_from` and a supplier with an `email`, when Send is clicked on that row, then Resend receives a request to that address and the row becomes `sent`.
3. Given a supplier with no email and a Resend key present, when Send is clicked, the row becomes `sent_manual` with a note in the response that no address was on file.
4. Given a row already `confirmed`, when Send all pending is clicked, that row is untouched.
5. Given a `sent` row, when an inbound POST with the supplier's from-address and text "Confirmed, see you at 10" hits the token URL, then `reply_text` is stored, `replied_at` set, `status = confirmed`.
6. Given the same but text "We can only take 10 not 14", then `status = replied`, and the Day view renders it with a CHECK tag and the reply text visible.
7. An inbound POST with an unknown token returns 404; with a known token but unknown sender returns 200 `{matched: false}` and writes nothing.
8. A non-member JWT calling with someone else's `operator_id` receives 403.
9. Setup lets the coordinator set category and email when adding a supplier, and both show in the Suppliers table.
10. `npm run build` passes.
