# Security

Mailcheap is provided as is, with no security support and no promise of fixes. If you run it, you're responsible for your deployment: keep dependencies updated and review changes before you deploy them.

## What's built in

- One admin login. Login attempts are rate limited per IP, and every login, new API key and send is logged and, with `ALERT_FROM` set, emailed to `ADMIN_EMAIL`.
- Mailcheap refuses to start with an `ADMIN_PASSWORD` under 12 characters or a `SESSION_SECRET` under 32.
- Sessions last 7 days, in an httpOnly cookie (`__Host-` prefixed in production) signed with a key derived from `SESSION_SECRET`. Changing `ADMIN_PASSWORD` or `ADMIN_EMAIL` signs out every session.
- Every dashboard page, API route and server action checks the session. Public routes are limited to what readers, mail providers, AWS SNS and QStash need, plus SparkLoop's webhook once it's connected.
- API keys are stored as SHA-256 hashes and can be revoked.
- Unsubscribe, confirmation, "keep sending it" and tracking links are signed with keys derived from `SESSION_SECRET`. Rotating it logs you out and breaks those links in emails already sent.
- SES webhooks only accept messages signed by AWS SNS for the topic in `SES_SNS_TOPIC_ARN`, with certificates from `https://sns.<region>.amazonaws.com/SimpleNotificationService-*.pem` only. Background jobs only run when QStash signed the request (except in `next dev`).
- Public endpoints (signup form, signup API, unsubscribe, views, login) are rate limited. With Upstash Redis the limits are shared across server instances; without it, or while it errors or times out, each instance counts in memory.
- Issue HTML shown inline on the archive goes through an allowlist cleaner, then `sanitize-html`, every time the page renders. HTML issues, including every one created through the API, render in a sandboxed iframe without scripts.
- Every response carries a Content Security Policy (no framing, no plugins, no inline event handlers, forms and `<base>` limited to the app's origin) and HSTS.
- Click tracking only redirects to links signed by the app, so it can't be used as an open redirect.
- SparkLoop (optional):
  - The API key is stored encrypted (AES-256-GCM, with a key derived from `SESSION_SECRET`).
  - The referral webhook's URL carries a random token, stored only as a SHA-256 hash. It answers 404 once SparkLoop is disconnected, only adds readers to the newsletter linked to the referral's publication, and is rate limited per newsletter.
  - With the signup flow on, a newsletter's archive pages load SparkLoop's script from `script.sparkloop.app`.
  - Card links in issues get the reader's email at the click redirect, only for SparkLoop's own domains, and never for test sends or link scanners. An email never contains it, and text anyone writes in an issue can't ask for it.

## The archive's domain

Issue pages show HTML that came from the editor and from API keys. Give each newsletter its own archive domain (`ARCHIVE_HOSTS`): that HTML then never shares the dashboard's origin, and the app domain's `/archive` pages redirect there. Without one, the archive stays on the app domain, protected by the sanitizer, the sandboxed frame and the Content Security Policy.

## Reporting a vulnerability

There's no support channel. If you find a problem, fix it in your own deployment. You can also open a pull request, but it may not be reviewed.
