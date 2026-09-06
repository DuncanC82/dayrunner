# Closest competitor: Automate.travel

Read 2026-09-06 from automate.travel (home, pricing, PaxFlow comparison, guide-management blog) plus Arival and LinkedIn.

## Who they are
- Kraków, Poland. Founder Krzysztof Balon, tour operator since 2012 (Todo.travel / AT Cracow, 100k+ guests a year). The product is his internal ops tool productised.
- Bootstrapped, no funding found. "Founding Members Program" still live, so early stage.
- Launched Arival Valencia late 2025, exhibited ITB Berlin and Arival Brisbane June 2026. Blog cadence ~3 posts a week in five languages, all SEO.
- Named customers (7): Your Friend in Reykjavik, Visit Meteora, Authentic Italy Adventures, Prague City Adventures, AT Cracow, Todo.travel, PolandVIP. None in ANZ.

## Positioning (their words)
- "Tour Operations Platform. Know your margins. Run your tours. One system."
- "The missing layer in tour operations." "CRM, ERP, and automation built for what happens after the sale."
- Founder quote: "No system did post-booking right. So we built one."

## What they ship today
| Block | Their description |
|---|---|
| Communication Hub | Email, WhatsApp, SMS, phone calls + transcription, one inbox, one timeline per guest |
| Automated Messages | Review requests, upsells, reminders, follow-ups |
| Guide Allocation | Assign guides to tours, manage availability and scheduling (manual) |
| Real Costs and True Margins | Per-booking margin, tour settlement (guide pay, vehicle, OTA fee, tips) |
| Self-service Portal | Manage bookings, waivers, info (marked coming soon on comparison page) |
| AI-powered Workflows | Automation rules; AI drafts contextual replies in the guest's language |
| Day Brief, incident tracking, fleet, guide portal | Listed on comparison page |

## Roadmap (explicitly not shipped)
"AI Agent That Works For You. Coming later this year: auto-assign guides and drivers to tours; send briefings and confirmations automatically; verify settlements and flag discrepancies."

## Pricing
Per booking, no monthly fee, no setup fee, cancel anytime: €1.50 for first 3,000 bookings a year, sliding to €1.20, €0.90, €0.75, €0.35 at 20k+. A 5,000-booking operator pays about €6,900 a year (~€575 a month). A 1,500-booking NZ operator pays ~€2,250 a year (~NZ$330 a month).

## ROI claims on their homepage (20,000 bookings a year baseline)
€109,390/yr extra profit (+73%), 1,963 hours saved (1.0 FTE), +1,000 reviews, €25,000 upsell revenue, €10,500 errors prevented. Not sourced. Implies ~6 minutes saved per booking.

## Integrations
Bókun, FareHarbor, Ventrata, Rezdy, Regiondo, TrekkSoft, Palisis. Mechanism undocumented. Not in Bókun App Store or FareHarbor partner directory.

## Where DayRunner is different (true today, in the code)
1. **Allocation is automatic and rule-bound.** DayRunner allocates vehicles and drivers deterministically with NZ work-time rules (5.5h/30min, 13h day, 10h rest, 70h period), km and skills. Automate allocates manually and its auto-assign is roadmap.
2. **Supplier loop is closed.** DayRunner sends reconfirmations by category and day and reads the replies out of the operator's own Gmail thread. Automate has no supplier reconfirmation at all.
3. **Charter and multi-day.** Tours, stops with audience-coded notes, rooming, coach requests to charter companies, guide day sheet. Automate is day-tour only (as is PaxFlow, which "can only handle Experiences").
4. **Decisions, not dashboards.** The product's unit is the exception list for tomorrow with options, approved by a human. Automate's unit is the inbox and the margin report.
5. **Local.** NZ-built, NZ rules, NZ support hours. Automate has no ANZ presence.

## Where they are ahead
- Unified inbox with phone transcription and a real CRM timeline per guest.
- Margin and settlement per booking (finance). DayRunner has none of this.
- 7 live customers and an operator-founder's 100k-guest test bed.
- Per-booking pricing removes the "second subscription" objection for small operators.
- Five-language content engine.

## What to copy
- The ROI calculator on the homepage. Ours must be honest and per-departure, not per-booking, and label estimates until pilots measure.
- Per-booking or per-departure pricing as an option beside the monthly tiers, to kill the second-subscription objection.
- Founder-operator credibility: lean on the two customer transcripts and the Epic integration work.

## What not to copy
- Margin/finance. That is Xero territory and a different buyer conversation.
- Broad "CRM/ERP" positioning. Our wedge is the morning: tomorrow's day, decided.

## Threat level
High on messaging and roadmap, low on execution risk in ANZ within 12 months. Their auto-assign will ship; their supplier loop and NZ rules will not. Watch: automate.travel/blog, Arival ANZ events, Bókun App Store listing.
