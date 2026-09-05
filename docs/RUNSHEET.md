# DayRunner — Build run sheet, 5 September 2026

Status key: [ ] todo · [~] in progress · [x] done · [!] blocked, needs Duncan

## A. Foundations
- [x] A1 Environment check (Node, Supabase CLI, GitHub auth)
- [x] A2 Create Supabase project PROD-DayRunner (Sydney)
- [x] A3 Scaffold Vite + React + TS app, install Supabase client, router, CSV parser
- [ ] A4 Create GitHub repo `dayrunner`, push, enable Pages with Actions deploy
- [ ] A5 PRD and run sheet committed

## B. Database and auth
- [ ] B1 Migration: operators, memberships, connectors, staff, staff_availability, vehicles, products, suppliers, rules
- [ ] B2 Migration: departures, bookings, plans, allocations, messages, supplier_confirmations, exceptions, incidents, audit_log
- [ ] B3 RLS: every table scoped by membership; helper `is_member(operator_id)`
- [ ] B4 Trigger: on new user, create operator + owner membership from sign-up metadata
- [ ] B5 Auth config: email + password, magic link; site URL set to Pages URL
- [ ] B6 Security advisor pass

## C. Edge functions
- [ ] C1 `plan-day`: deterministic allocator + pickup sequencing + message drafting + suppliers + exceptions; optional Claude pass
- [ ] C2 `import-csv`: map columns, upsert departures and bookings
- [ ] C3 `rezdy-sync`: pull bookings/sessions/resources by API key; webhook receiver for ORDER events
- [ ] C4 `fareharbor-webhook`: receive full booking JSON; `fareharbor-sync` availabilities → bookings
- [ ] C5 `rcm-sync`: adapter scaffold, config-driven field map
- [ ] C6 `send-messages`: Twilio WhatsApp/SMS, Resend email, manual fallback; audit log
- [ ] C7 Secrets: ANTHROPIC_API_KEY optional; provider creds per operator

## D. App
- [ ] D1 Auth pages: sign up, sign in, magic link, sign out
- [ ] D2 Onboarding wizard: operator, fleet, staff, rules, suppliers, connector
- [ ] D3 Day view: date picker, Plan button, summary tiles, exceptions, allocation board, pickup runs
- [ ] D4 Messages: approval queue, edit, hold, approve all, send
- [ ] D5 Suppliers: confirmations with due times, mark confirmed
- [ ] D6 Incidents: no-show and incident log per departure
- [ ] D7 Settings: connectors (Rezdy key, FareHarbor webhook URL, RCM config, CSV mapping), messaging provider, voice
- [ ] D8 Guide run sheet view (read-only, mobile)
- [ ] D9 Sample data loader (Remarkables Day Tours) so a new workspace demos instantly

## E. Marketing site
- [ ] E1 Landing page: pitch, the Epic story, evidence, how it works, pricing, founding-partner CTA
- [ ] E2 Sign-up flow into the app

## F. Deploy and verify
- [ ] F1 Build, push, Pages deploy green
- [ ] F2 Browser test: sign up → onboarding → load sample → plan → approve → send (manual) → incident
- [ ] F3 CSV import test with a Rezdy-style export
- [ ] F4 Fix, redeploy, final screenshot set

## G. Needs Duncan (blocked on credentials only, everything else works without them)
- [!] G1 ANTHROPIC_API_KEY in Supabase secrets for the Claude drafting pass
- [!] G2 Twilio account SID/token + WhatsApp sender, or Resend key, for live sending
- [!] G3 A Rezdy Expansion-plan API key from a design partner (staging account works for testing)
- [!] G4 FareHarbor Software Partner application (email support@fareharbor.com)
- [!] G5 Custom domain DNS
