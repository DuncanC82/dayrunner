# Gmail connector: Google Cloud setup

Do these once. Nothing in the repo contains Google credentials; the edge functions read them from Supabase secrets and return `{"error":"missing GOOGLE_CLIENT_ID"}` (etc.) until they are set.

## 1. Google Cloud project

1. Go to https://console.cloud.google.com and create a project, e.g. `DayRunner`. (Any Google account works; use the one that will own the app long-term.)
2. APIs & Services → Library → search "Gmail API" → Enable.

## 2. OAuth consent screen

1. APIs & Services → OAuth consent screen (Google Auth Platform → Branding).
2. User type: **External**. App name `DayRunner`, support email, developer contact email. Homepage: the DayRunner site. Privacy policy URL: required before verification; a page on the site is fine.
3. Scopes → Add or remove scopes → add:
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `openid`
4. Test users → add the Google accounts that will connect while the app is unverified: your own, `demo+tours@prompt6.com` if it is a Google account, and each design partner's Workspace address. Max 100.
5. Leave Publishing status as **Testing** for now. Note: in Testing, refresh tokens expire after 7 days. When a partner goes live, Publish the app and submit for verification (sensitive scopes: expect a few days to a few weeks; they will ask for a demo video showing the consent screen and how DayRunner uses read + send).

## 3. OAuth client

1. APIs & Services → Credentials → Create credentials → OAuth client ID → **Web application**, name `DayRunner Supabase`.
2. Authorised redirect URIs → add exactly:

   `https://tylttoheoazyvbuixrrk.supabase.co/functions/v1/gmail-auth/callback`

3. Authorised JavaScript origins are not needed (the browser never talks to Google's token endpoint).
4. Create → copy the **Client ID** and **Client secret**.

## 4. Supabase secrets

```
supabase secrets set \
  GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com \
  GOOGLE_CLIENT_SECRET=<client secret> \
  GOOGLE_REDIRECT_URI=https://tylttoheoazyvbuixrrk.supabase.co/functions/v1/gmail-auth/callback \
  GMAIL_POLL_SECRET=$(openssl rand -hex 24) \
  --project-ref tylttoheoazyvbuixrrk
```

Optional: `GMAIL_STATE_SECRET=<random>` to sign OAuth state with something other than the client secret.

No redeploy is needed after setting secrets; edge functions read env at request time.

## 5. Connect

App → Connectors → Gmail → Connect Google → pick the account → "Google hasn't verified this app" → Continue → tick both Gmail permissions → back in DayRunner with "Gmail connected as …".

## 6. Scheduled polling (optional)

Any scheduler that can POST every 5–10 minutes:

```
curl -X POST https://tylttoheoazyvbuixrrk.supabase.co/functions/v1/gmail-poll \
  -H "x-poll-secret: <GMAIL_POLL_SECRET>" -H "Content-Type: application/json" -d '{}'
```

With pg_cron + pg_net in Supabase:

```sql
select cron.schedule('gmail-poll', '*/10 * * * *', $$
  select net.http_post('https://tylttoheoazyvbuixrrk.supabase.co/functions/v1/gmail-poll',
    '{}'::jsonb, '{}'::jsonb,
    '{"Content-Type":"application/json","x-poll-secret":"<GMAIL_POLL_SECRET>"}'::jsonb);
$$);
```

Until a schedule exists, the "Check inbox now" button does the same thing on demand.

## Troubleshooting

- `redirect_uri_mismatch`: the URI in step 3 must match `GOOGLE_REDIRECT_URI` byte for byte.
- `access_denied` / "app not verified" with no Continue button: the account is not in Test users.
- `invalid_grant` on send or poll: refresh token expired (7-day Testing limit) or revoked; click Reconnect Google.
- `Google did not return a refresh token`: remove DayRunner at https://myaccount.google.com/permissions and connect again.
