# Domain: dayrunner.co.nz

Decided 2026-09-06. Also register dayrunner.nz (defensive, redirect to .co.nz).

## 1. Register (Duncan, needs a card)
Any .nz registrar. Metaname or 1st Domains are fine. Registrant: Duncan's company. Turn on auto-renew. Keep the registrar's default nameservers.

## 2. DNS records at the registrar
GitHub Pages apex + www:

| Type | Host | Value |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| AAAA | @ | 2606:50c0:8000::153 |
| AAAA | @ | 2606:50c0:8001::153 |
| AAAA | @ | 2606:50c0:8002::153 |
| AAAA | @ | 2606:50c0:8003::153 |
| CNAME | www | duncanc82.github.io |

Email (once a mailbox provider is chosen, Google Workspace recommended so the Gmail connector and outreach come from the same place):
| TXT | @ | v=spf1 include:_spf.google.com ~all |
| MX | @ | Google Workspace MX records |
| TXT | google._domainkey | DKIM key from Workspace admin |
| TXT | _dmarc | v=DMARC1; p=none; rua=mailto:dmarc@dayrunner.co.nz |

## 3. Cut over (Claude, after DNS resolves)
1. Merge branch `custom-domain` (app/public/CNAME = dayrunner.co.nz, vite base "/").
2. GitHub repo Settings > Pages: custom domain dayrunner.co.nz, wait for DNS check, tick Enforce HTTPS.
3. Verify https://dayrunner.co.nz/ and https://dayrunner.co.nz/#/app load and sign-in works.
4. Supabase Auth: Site URL = https://dayrunner.co.nz, add https://dayrunner.co.nz/** to redirect allow list; keep the github.io entry for a week.
5. Google Cloud OAuth consent: application home page and authorised domain = dayrunner.co.nz.
6. Reseed demos (return_to URLs), re-render the video close card and thumbnail line, update outreach drafts and landing copy.
7. Add domain verification for Google Search Console and, when Workspace is on, the Gmail sending domain.

## 4. Leave alone
Supabase functions stay on tylttoheoazyvbuixrrk.supabase.co. Custom API domain is a paid add-on; not needed for pilots.
