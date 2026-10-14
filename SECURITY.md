# Security

## Accounts and data

- Every customer document carries its `accountId`, and a Mongoose plugin rejects any query, aggregation or bulk write on customer models without one. Cross-account lookups are explicit (`{ crossAccount: true }`) and limited to signed links, tracking links, public archive slugs and the API key lookup.
- Integration tests (`tests/isolation.test.mjs`, `tests/api.test.mjs`, `tests/mcp.test.mjs`) sign in two accounts and check that neither can list, read, change or delete the other's newsletters, contacts, campaigns, API keys or uploads, or sign contacts up into the other's newsletter, through server actions, data functions, the REST API and MCP.
- The dashboard shows one newsletter at a time, named by a cookie that is never trusted: every read checks it against the account and falls back to the account's first newsletter, and the newsletter menu and `/newsletters/<id>` only set it to one of the account's newsletters. Server actions that take a newsletter (new campaigns, imports, exports) check the ID against the account too (`tests/newsletters.test.mjs`).
- Uploads are stored under `accounts/<accountId>/`, a path that comes from the account, never from the request. On S3 the bucket is private: readers get images through the CDN, and the app's IAM user can only put, get and delete objects under `accounts/` (deletes only for a deleted account's purge and for an upload whose record wasn't saved) and create invalidations on the CDN's distribution, with keys of its own, never default AWS credentials.

## API keys, REST and MCP

- The dashboard, the REST API and the MCP server run the same actions (`lib/actions`), so the same permission, plan, rate limit and input checks apply everywhere. A test fails if a dashboard server action does anything but run a registered action, apart from the newsletter menu's, which only sets which of the account's newsletters the dashboard shows.
- API keys are 32 random bytes, stored as SHA-256 hashes and shown once. They belong to one account and only reach its data. Revoking one takes effect on the next request.
- Two levels: full access, and signups only, which can only add contacts. Keys made before levels count as signups only. Only a full access key can create keys.
- Each key gets 300 requests a minute across REST and MCP, plus an hourly limit on actions that send, import, upload, add domains, create keys or call Stripe. Signups keep the per-key and per-visitor limits they had.
- Only the signup endpoint answers browsers (CORS), so a full access key in a web page doesn't work from it.
- Errors outside the documented codes answer `internal_error` without detail; the detail goes to the server log.
- The MCP send tools are annotated destructive and say sending can't be undone. Sending a campaign that is already sending or sent answers `conflict`.
- OAuth (ChatGPT, Claude): Better Auth issues access tokens signed RS256 with a key it keeps encrypted with `BETTER_AUTH_SECRET`. `/mcp` accepts a token only with MailCheap's issuer, `/mcp` as its audience, the `at+jwt` type, an unexpired `exp`, the `mailcheap:full` scope, a valid DPoP proof when it's bound to a key, and the id of a consent that still exists for its user and app. Tokens last an hour; refresh tokens are stored hashed, rotate on use, and expire 90 days after the last use.
- An app gets the same access as a full access key, in its user's account only, after the user signs in and allows it on the consent page, which names the app's host. PKCE (S256) is required, redirect URIs must match the app's client metadata document or registration exactly (loopback ports aside), and responses carry the issuer (RFC 9207). Disconnecting an app on the API keys page deletes its tokens and consent; its access tokens answer 401 from the next request.
- Client metadata documents are fetched over https with the address resolved once and pinned, private and reserved addresses refused, redirects refused, 5 KB at most. Better Auth's client and consent management routes are closed.
- Dynamic client registration (RFC 7591, for Grok Bot on Cursor's agents) takes public clients only (`token_endpoint_auth_method` `none`) whose redirect URIs are all on the allowlist in `lib/oauth-rules.js`, without a back-channel logout URI, 10 an hour per IP. Registered clients are bound to `/mcp` and go through the same consent page.
- Contacts exports are signed links (a key derived from `BETTER_AUTH_SECRET`) that name the account and the filters and expire after an hour. Anyone holding a link can download the file until then.
- Images uploaded by URL are downloaded over https on port 443 only, and the connection is refused when the host resolves to a loopback, private, link-local, carrier-grade NAT, documentation, multicast or reserved address, checked at connect time and after each of up to 3 redirects. Size is capped at 4 MB while reading.
- A from address is either the newsletter's shared address (`hello@<slug>.SHARED_DOMAIN`) or on a domain the account verified; it's checked when a newsletter is saved, before every send and again for each email. A domain, a shared sending subdomain and an archive subdomain belong to one account, and at the provider to that account's tenant only.
- Provider events are recorded only in the account they name: SES's `account_id` tag; PostShiba's `account_id` unique arg, which has to match the PostShiba tenant on the event, or, without unique args, that tenant's account. An event whose tenant isn't the named account's is dropped. CSV imports record the customer's consent, who gave it and when.

## Sign-in

- Better Auth sessions in httpOnly cookies, stored in the database, so signing out or revoking a session takes effect at once.
- Session cookies are host-only (no `Domain`), and Better Auth trusts `APP_URL`'s origin only. When the shared domain is the app's own (MailCheap Cloud: archives on `<slug>.mailcheap.ai`), archive hosts never get the cookie, but browsers still send it with an archive page's requests to the app, the same site. Better Auth refuses those from any other origin, server actions check the origin against the host, uploads take same-origin requests only, and archive pages run no customer script and post forms only to themselves. Slugs can't take `www` or MailCheap's other subdomains (`lib/reserved-slugs.js`), and those hosts never open an archive.
- Sign-in codes are 6 digits, expire after 5 minutes, die after 3 wrong tries and are stored hashed. Sending them is rate limited per IP and per email; checking them is rate limited per IP. Better Auth's own code and password routes are closed.
- A Google sign-in joins an existing user only when Google says it verified that email: Google isn't a trusted provider for account linking.
- MailCheap Cloud takes one account per inbox: a new user whose address reaches an existing user's inbox (Gmail ignores dots and +tags; Outlook, Hotmail, Live, iCloud, Fastmail and Proton +tags; Yahoo -tags, in `lib/email-aliases.js`) is refused once the code or Google proved the address, so the refusal tells nobody else anything. Throwaway domains get no code and no new account, and an IP address gets 3 new accounts a day. Accounts from before keep signing in.
- Without `RESEND_API_KEY` or an email provider, development prints codes in the server console; production never does.
- After sign-in, the app only goes on to a path on its own site with at most a plain query string (`/billing/checkout?plan=growth&interval=year`): never another host or a protocol-relative path.
- `/billing/checkout` (the plan buttons) only opens Checkout for a signed-in account without a plan. A paying account gets the billing page, where Stripe confirms any change.
- An account without a plan can set up its newsletter and write campaigns, nothing that reaches outside MailCheap: no emails (tests included), imports, domains or API keys, nothing at the email provider or in DNS until its plan starts, and 20 image uploads a day.
- `/admin` and its actions answer 404 to anyone whose verified email isn't in `ADMIN_EMAILS`.
- The server refuses to start with a `BETTER_AUTH_SECRET` under 32 characters.

## Deleting an account

- Only its owner deletes it, on the account page: it isn't an action, so no API key or connected app can, and a test fails if one appears. Better Auth's user update route is closed too: the page changes the name, and a photo only to one of the account's uploads.
- It's refused while Stripe bills a plan (active, trialing or past due), which the billing portal cancels, and while a campaign sends or is scheduled.
- It takes a code sent for it, of a kind no sign-in uses (Better Auth's email OTP, stored hashed, 5 minutes, one use, 3 tries, 3 codes per 15 minutes), and the account's email typed out. The email says what the code is for, so an owner who didn't ask knows.
- At once, every session of the owner ends, API keys are revoked, connected apps lose their consents and tokens, and the account counts as unpaid everywhere, self-hosted too: no emails, signups or archive, and the REST API, MCP and the dashboard refuse it. Its tenant is suspended at the provider.
- The purge runs 30 days later as a signed QStash job. Signing in before then offers to restore the account; once the purge starts, it can't be. Every query it runs names the account, so it can't reach another one. It deletes the user with its sessions, sign-in methods and codes, everything with the account's id, its domains and shared subdomains at the provider with the DNS records published for them, its tenant, and its images on S3 and Vercel Blob, then invalidates the account's folder on CloudFront so the CDN stops serving them.
- What stays: Stripe's own billing records, and a deletion record with an HMAC of the email (a key derived from `BETTER_AUTH_SECRET`), the account's id and the dates, nothing else. A new account with that email alerts the admins.

## Self-hosted servers

Without `MAILCHEAP_CLOUD=true` (only that exact value counts), a server is self-hosted:

- Only `ALLOWED_EMAILS` (addresses, and `@domain` for every address of exactly that domain) and `ADMIN_EMAILS` sign in. With both empty, nobody does: it's never open by default.
- The list is checked when a code is asked for and when it's checked, and Better Auth's user and session hooks refuse anyone off it whatever the route (codes, Google, the auth API), so no new user or session can exist for them. The email also has to be verified (by the code, or by Google).
- Someone taken off the list is signed out at their next request, and their API keys stop working on the REST API and MCP, until they're back on it.
- There's no billing: no paywall, no plan limits, and the billing actions, the billing page and the Stripe webhook answer that billing is off. The automatic blocks on spam signals stay on.
- MailCheap Cloud's marketing pages, which the open source doesn't have, answer 404. The public docs footer keeps a link to the source code, which the AGPL asks a modified server to offer its users.

## MailCheap's own emails

- Sign-in codes and alerts go through Resend, apart from customers' emails. On MailCheap Cloud they never go any other way. A self-hosted server without `RESEND_API_KEY` sends them through its email provider from `EMAIL_FROM`: on SES outside every tenant, on PostShiba through a tenant of their own (`mc-platform`), so a customer's tenant never carries them.
- `SENDING_ENABLED` holds readers' emails only: sign-in codes and alerts don't wait for it.

## Billing

- MailCheap Cloud refuses to start without `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `RESEND_API_KEY`, and `/api/health` answers 503 with which one is missing (names, never values), so the cloud can't run free or without sign-in emails by mistake.
- Stripe webhooks are verified with `STRIPE_WEBHOOK_SECRET`, and every subscription event re-reads the subscription from Stripe instead of trusting the payload.
- The checkout return only syncs a session whose `client_reference_id` is the signed-in account.
- Checkout refuses a Stripe price whose amount or interval doesn't match `lib/plans.js`.

## Sending

- SES only runs with MailCheap's own keys (`SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`), never with default AWS credentials from the machine. `EMAIL_PROVIDER` with an unknown value stops sending instead of picking a provider.
- Each account has its own tenant at the provider. PostShiba's SMTP password for a tenant (shown once) is stored AES-256-GCM encrypted with `CREDENTIALS_ENCRYPTION_KEY`, a random IV per value and the account and cluster authenticated with it, so a value copied onto another account doesn't decrypt. It's left out of every read of the account but the PostShiba adapter's (which decrypts it for campaign sends), never sent to a browser and never logged; a separate transactional cluster's password isn't kept at all.
- Bounce and complaint rates have two levels (`LIMITS` in `lib/config.js`, judged out of emails sent in `lib/rate-levels.js`), each with a minimum count, so one complaint never stops anything. Over 2% hard bounces with at least 5, or 0.08% complaints with at least 2, a campaign pauses and its owner is emailed; they can resume it, and from then on only the block level stops that campaign. A first send's slice at that level holds the rest of its campaign the same way; the last 7 days at that level only warn the owner, once a day at most.
- Clear abuse blocks the whole account (`lib/account-blocks.js`): over 5% hard bounces with at least 10, or 0.3% complaints with at least 3, on a campaign, a first send's slice or the last 7 days; a hard bounce that names a spam trap; SES disabling the tenant or a high-impact finding; PostShiba's `operator_hold`; and an admin. A blocked account sends nothing, welcome and confirmation emails included, on any plan; its tenant is suspended at the provider, its archive takes no signups, and the dashboard, REST API and MCP refuse every change with `account_blocked` except pausing, unscheduling, discarding, revoking keys and apps, and billing. Every block emails the admins at once. Nothing lifts a block on its own, a provider lifting its pause included: only an admin, from `/admin`, once the provider resumed the tenant.
- During an account's first 30 days, campaigns go out over 24, 16 and 12 hours, then 8 (`lib/send-spread.js`). Contacts the account never emailed go in a slice of 5% (200 to 2,000), and the rest waits 3 hours for the slice's bounces and complaints (`lib/first-send.js`).
- Every address takes one syntax: a dot-atom, no doubled dots, a domain ending of letters or `xn--`. Imports drop misspelled provider domains (`lib/email-typos.js`) and spam trap addresses; the archive's form, `add_contact` and MCP refuse them, and domains that can't receive email, with the address a misspelling was likely meant to be.
- Unsubscribe, confirmation, "keep sending it" and tracking links are signed with keys derived from `BETTER_AUTH_SECRET`. Rotating it signs everyone out and breaks those links in emails already sent.
- SES webhooks only accept messages signed by AWS SNS for the topics in `SES_SNS_TOPIC_ARN` and `SES_TENANT_SNS_TOPIC_ARN`. The PostShiba webhook only accepts requests whose `X-Capsule-Signature` is the HMAC-SHA256 of `{timestamp}.{raw body}` with `POSTSHIBA_WEBHOOK_SECRET`, compared in constant time, with a timestamp within 5 minutes; redelivered events are recorded once. Background jobs only run when QStash signed the request (except in `next dev`).
- The app never holds a Vercel token. On MailCheap Cloud, shared subdomains' records go through a DNS helper (`dns-broker/`), a Vercel project of its own and the only place with the token. It takes requests signed with `DNS_BROKER_SECRET` (HMAC-SHA256 of `{timestamp}.{body}`, compared in constant time, 5 minutes at most), has mailcheap.ai, the team and the list, create and delete record endpoints fixed in its code, and only writes a shared address's records under `<slug>.mailcheap.ai` for a slug that isn't MailCheap's: the archive's CNAME to `cname.vercel-dns.com`, PostShiba's DKIM CNAME to `*.customers.postshiba.com` and return path CNAME to `rp.postshiba.com`. It tags each record for its slug, deletes only those, never writes in a slug that has a record it didn't tag, stops at 90 new records a day, and logs every create, delete and refusal without the token, the secret or headers.
- Public endpoints (signup form, signup API, unsubscribe, views, sign-in) are rate limited. With Upstash Redis the limits are shared across server instances; without it, each instance counts in memory.
- Issue HTML shown on the archive goes through an allowlist cleaner and `sanitize-html` on every render; HTML issues render in a sandboxed iframe without scripts.
- Every response carries a Content Security Policy (no framing, no plugins, no inline event handlers, forms and `<base>` limited to the app's origin) and HSTS. Click tracking only redirects to links signed by the app.

## Known gaps

- The first account to add a domain holds it until it removes it, verified or not; its real owner has to ask support.
- An API key can't be limited to read-only or to one newsletter yet; a full access key can do anything the owner can, billing links included.
- Invalid keys aren't rate limited by IP before their database lookup (a unique index on the hash, so each costs one indexed read).
- Tenants separate suppression lists and provider pauses, but capacity and IP reputation are still shared: SES's account quota and reputation, and on PostShiba each cluster's shared IP and hourly cap, used by every account on it.
- Vercel tokens can't be limited to DNS (a project-scoped token can't edit it): the helper's token can do anything in the team, and only the helper's code and its own project keep it to mailcheap.ai's records. Anyone with `DNS_BROKER_SECRET` can create or delete shared address records within those rules, up to the daily cap.
- Customers' own archive subdomains aren't added to the Vercel project for them: on Vercel that's done by hand.
- When a slug changes, a sending subdomain the provider fails to remove stays in the old account's tenant (an admin alert says so) and blocks the slug's next owner from its shared address until it's removed.
- On a self-hosted server without a shared domain or an archive subdomain, the archive is served from the app's own domain, where only the sanitizer, the sandboxed frame and the Content Security Policy keep issue HTML away from the dashboard.
- Sign-in tells whether an email is on a self-hosted server's list. The per-IP and per-email limits slow down anyone trying addresses.
