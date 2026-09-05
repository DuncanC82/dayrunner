# DayRunner — Build run sheet, 5 September 2026

Status key: [ ] todo · [~] in progress · [x] done · [!] blocked, needs Duncan

## A. Foundations
- [x] A1 Environment check (Node, Supabase CLI, GitHub auth)
- [x] A2 Create Supabase project PROD-DayRunner (Sydney)
- [x] A3 Scaffold Vite + React + TS app, install Supabase client, router, CSV parser
- [x] A4 Create private GitHub repo `dayrunner`, push; Pages workflow committed (see F1)
- [x] A5 PRD and run sheet committed

## B. Database and auth
- [x] B1 Migration: operators, memberships, connectors, staff, staff_availability, vehicles, products, suppliers, rules
- [x] B2 Migration: departures, bookings, plans, allocations, messages, supplier_confirmations, exceptions, incidents, audit_log
- [x] B3 RLS: every table scoped by membership; helper `is_member(operator_id)`
- [x] B4 Trigger: on new user, create operator + owner membership from sign-up metadata
- [~] B5 Auth: email + password and magic link work; email confirmation is on (test account confirmed by SQL). Site URL + leaked-password protection to set in the Supabase Auth dashboard once the public host is chosen
- [x] B6 Security advisor pass

## C. Edge functions
- [x] C1 `plan-day`: deterministic allocator + pickup sequencing + message drafting + suppliers + exceptions; optional Claude pass
- [x] C2 `import-csv`: map columns, upsert departures and bookings
- [x] C3 `rezdy-sync`: pull bookings/sessions/resources by API key; webhook receiver for ORDER events
- [x] C4 `fareharbor-webhook`: receive full booking JSON; `fareharbor-sync` availabilities → bookings
- [x] C5 `rcm-sync`: adapter scaffold, config-driven field map
- [x] C6 `send-messages`: Twilio WhatsApp/SMS, Resend email, manual fallback; audit log
- [x] C7 Provider creds stored per operator in settings; ANTHROPIC_API_KEY optional (see G1)

## D. App
- [x] D1 Auth pages: sign up, sign in, magic link, sign out
- [x] D2 Onboarding wizard: operator, fleet, staff, rules, suppliers, connector
- [x] D3 Day view: date picker, Plan button, summary tiles, exceptions, allocation board, pickup runs
- [x] D4 Messages: approval queue, edit, hold, approve all, send
- [x] D5 Suppliers: confirmations with due times, mark confirmed
- [x] D6 Incidents: no-show and incident log per departure
- [x] D7 Settings: connectors (Rezdy key, FareHarbor webhook URL, RCM config, CSV mapping), messaging provider, voice
- [x] D8 Guide run sheet view (read-only, mobile)
- [x] D9 Sample data loader (Remarkables Day Tours) so a new workspace demos instantly

## E. Marketing site
- [x] E1 Landing page: pitch, the Epic story, evidence, how it works, pricing, founding-partner CTA
- [x] E2 Sign-up flow into the app

## F. Deploy and verify
- [!] F1 Public hosting: GitHub Pages workflow is committed but needs the repo public (permission gate blocked me flipping it); Supabase Storage and edge functions rewrite HTML to text/plain on the default domain. Runs locally on :5177 and deploys with `node deploy.mjs` once a host is chosen
- [x] F2 Browser test: sign up → onboarding → load sample → plan → approve → send (manual) → incident
- [x] F3 CSV import test with a Rezdy-style export
- [x] F4 Fix, redeploy, final screenshot set

## G. Needs Duncan (blocked on credentials only, everything else works without them)
- [!] G1 ANTHROPIC_API_KEY in Supabase secrets for the Claude drafting pass
- [!] G2 Twilio account SID/token + WhatsApp sender, or Resend key, for live sending
- [!] G3 A Rezdy Expansion-plan API key from a design partner (staging account works for testing)
- [!] G4 FareHarbor Software Partner application (email support@fareharbor.com)
- [!] G5 Choose a public host: make the GitHub repo public (Pages deploys automatically), or give me a Netlify/Vercel/Cloudflare token, or add a custom domain to Supabase

## H. Verified today (browser, 5 Sep 2026)
- Sign up → trigger creates operator + owner membership + default rules
- Sign in (password) → Day view
- Load sample operator → 4 staff, 4 vehicles, 3 products, 4 suppliers, 4 departures, 19 bookings
- Plan the day with a weather alert → 4 allocations, 19 messages (holds on OTA no-contact and decision-blocked departures), 5 supplier confirmations, 6 exceptions incl. two over-hours drivers and one departure with no driver
- Approve all → mark sent by hand → 14 sent, plan status = sent, audit log written
- No-show logged against a booking
- Run sheet renders per driver with pickup sequence
- CSV import (Rezdy-style export) upserts departures + bookings under RLS as the signed-in user
- Security advisor: SECURITY DEFINER functions locked down; remaining warning is leaked-password protection (dashboard toggle)
