# Gmail connector

Version 0.1 · 6 September 2026 · Status: built, awaiting Google Cloud credentials

## Problem

Multi-day tour operators run their supplier loop out of Gmail. Supplier reconfirmations go out from the operator's own address; replies ("confirmed for 16"), coach-company quotes (driver name, price) and agent/OTA booking emails all land back in that same inbox. DayRunner today sends supplier confirmations through Resend from a generic address, which suppliers do not recognise and which strips the operator's own signature and thread history, and it only receives replies through an inbound-email webhook that nobody has wired to a relay. The result: the operator still reads every reply by hand and re-keys "confirmed" into DayRunner.

## Evidence

Jackie, multi-day tour operator, on how she tracks suppliers: "I'm used to looking at it in a Google inbox where we've got folders for each category for each day." Three things in that: (1) Gmail is the system of record for supplier correspondence, not a CRM; (2) she already organises by category and day, exactly the shape of DayRunner's supplier list; (3) any tool that sends from somewhere else creates a second place to look.

## User stories

- As the coordinator, I want reconfirmations and coach requests to go out from `ops@mytours.co.nz` so suppliers see a name they know and reply into the thread they already have with me.
- As the coordinator, I want DayRunner to notice when Glacier Explorers replies "all good for 16" and mark that confirmation green without me re-typing it.
- As the coordinator, I want to keep working in Gmail (folders, search, mobile app) and have DayRunner read alongside me, not replace my inbox.
- As the owner, I want to connect Google once with a normal consent screen, and be able to disconnect at any time.

## Scope

In: OAuth connect/reconnect/disconnect per operator; sending via the Gmail API from the connected address for supplier confirmations, transport requests and guest email messages; polling the inbox for new messages; matching replies to supplier confirmations and transport requests; a list of recent inbound emails in Connectors. Gmail wins over Resend when both are configured; Resend stays as fallback; manual stays as the last fallback.

Out (this version): Gmail push notifications (Pub/Sub watch); applying Gmail labels; parsing OTA/agent booking emails into bookings (`matched_to = 'booking'` is reserved in the schema for that next step); HTML email; attachments; multiple Google accounts per operator.

## OAuth flow

1. Browser: `POST /functions/v1/gmail-auth` `{operator_id, return_to}` with the member JWT. The function checks membership, signs a state token `{operator_id, return_to, user_id, exp: +10 min}` with HMAC-SHA256 (secret `GMAIL_STATE_SECRET`, falling back to `GOOGLE_CLIENT_SECRET`) and returns Google's consent URL (`access_type=offline`, `prompt=consent`, scopes below).
2. Browser redirects to Google. Operator picks the Workspace account and consents.
3. Google redirects to `GET https://tylttoheoazyvbuixrrk.supabase.co/functions/v1/gmail-auth/callback?code=&state=`. No JWT is available on a browser redirect, which is why the signed state carries the operator id. The function verifies the signature and expiry, exchanges the code (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`), reads the account email from `userinfo`, upserts the `gmail` connector, and 302s to `return_to?gmail=connected&gmail_email=...` (or `?gmail_error=...`).
4. The Connectors page reads those query params, shows the result, and strips them from the URL.

Google returns a refresh token only on first consent; we set `prompt=consent` so reconnects always get a fresh one, and we keep the old one if none comes back.

## Scopes

| scope | why |
|---|---|
| `gmail.send` | send from the operator's address |
| `gmail.readonly` | list and read inbox messages |
| `userinfo.email` + `openid` | learn which address was connected |

`gmail.modify` is deliberately not requested. Labels would be nice ("DayRunner/matched") but they cost a broader scope and a harder verification review. Read state lives in our own tables (`inbound_emails`, `connectors.config.last_poll_at`) instead.

## Token storage

`connectors` row with `kind = 'gmail'`, one per operator (partial unique index). `secret` holds the Google refresh token (never exposed to the browser: `connectors_public` only reports `has_secret`). `config = { email, last_poll_at, history_id?, label_ids?, scopes }`. Access tokens are minted per call from the refresh token and never persisted. Disconnect deletes the row; the operator can also revoke at myaccount.google.com/permissions.

## Sending

`_shared/gmail.ts` `sendOperatorEmail()` is the single email route: Gmail connector present → `users.messages.send` with an RFC 2822 message (base64url raw; UTF-8 subject; optional `threadId` so a resend stays in the same thread) → else Resend from `settings.messaging` → else `null`, which the caller turns into manual mode. `supplier-confirm`, `transport-request` and `send-messages` (email channel) all use it. Responses report `via: gmail | resend`. Standalone: `POST /functions/v1/gmail-send {operator_id, to, subject, text, in_reply_to?, thread_id?}`.

The Gmail thread id returned by send is stored in `supplier_confirmations.gmail_thread_id` / `transport_requests.gmail_thread_id`.

## Polling model

`POST /functions/v1/gmail-poll`:

- `{operator_id}` with member JWT: poll that operator (the "Check inbox now" button).
- `{}` with header `x-poll-secret: $GMAIL_POLL_SECRET`: poll every gmail connector (for pg_cron / cron-job.org / GitHub Actions every 5–10 minutes).

Each poll runs `messages.list` with `q = in:inbox -from:me after:<last_poll_at − 1h>` (epoch seconds, max 50), skips ids already in `inbound_emails`, fetches the rest with `format=full`, extracts text (plain part, else stripped HTML), trims quoted history, inserts the row, runs the matcher, and stamps `matched_to` / `matched_id` / `processed_at`. `last_poll_at` and `last_sync_at` advance on success; failures set `connectors.status = 'error'` and `last_error`. `history_id` is reserved in config for switching to `history.list` later; the one-hour overlap plus the unique `gmail_message_id` makes the current approach safe and idempotent.

## Matching model

`_shared/inbound.ts` `matchInbound()`:

1. Thread: `gmail_thread_id` equals the message's `threadId` on a `supplier_confirmation` → apply supplier reply (YES regex → `confirmed`, else `replied`; store `reply_text`, `replied_at`). Else on a `transport_request` → apply transport reply (extract driver name/phone/price/inclusions; YES → `confirmed`, NO → `declined`).
2. Sender fallback: sender matches a supplier's `email` or `contact`; an open transport request (`requested`/`pending`) for that supplier wins, else the most recently sent (or soonest pending) supplier confirmation.
3. Otherwise `matched_to = 'none'`; the row still appears in the Connectors list so the coordinator can see what came in.

The legacy relay webhooks (`supplier-confirm?token=` and `transport-request?token=`) now call the same shared functions, so behaviour is identical whichever way a reply arrives. Every applied reply writes an `audit_log` row.

## Acceptance tests

1. Without Google secrets set, `POST gmail-auth` with a valid member JWT returns HTTP 500 `{"error":"missing GOOGLE_CLIENT_ID", "hint": ...}`; nothing else breaks.
2. With secrets set and the operator's account listed as a test user, Connect Google → consent → redirected back with "Gmail connected as ops@…"; a `connectors` row with `kind='gmail'`, `has_secret=true`, `config.email` set.
3. Sending supplier confirmations with a Gmail connector produces `via: "gmail"` results, mail arrives from the operator's address, and `gmail_thread_id` is populated.
4. A supplier replying "Confirmed, all good for 16" in that thread → "Check inbox now" → confirmation status `confirmed`, `reply_text` stored, one `inbound_emails` row with `matched_to='supplier_confirmation'`.
5. A coach company replying "Yes locked in, driver is Sam Jones 021 555 1234, $2,400 meals included" → transport request `confirmed`, driver_name "Sam Jones", price 2400, meals true.
6. Re-running poll twice does not duplicate rows or re-apply replies (unique `gmail_message_id`).
7. Deleting the connector → next send falls back to Resend (if configured) or `sent_manual`; supplier-confirm in manual mode is unchanged.
8. A random newsletter in the inbox → `inbound_emails` row with `matched_to='none'`, no status changes anywhere.
9. `inbound_emails` is only readable by members of the operator (RLS `is_member`).

## Google verification note

`gmail.send` and `gmail.readonly` are sensitive scopes. While the OAuth consent screen is in Testing, only listed test users (max 100) can connect and Google shows an "unverified app" warning; refresh tokens for testing-mode apps expire after 7 days unless the app is set to External + published, so plan to submit for verification before design partners rely on it daily. Verification needs a privacy policy URL, a homepage that describes the Gmail use, and a short demo video. Until then, each design partner's Google account is added as a test user in Google Cloud. See `gmail-setup.md`.
