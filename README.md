# Mailcheap

Mailcheap is a self-hosted newsletter app on Amazon SES or Resend. Write an issue, send it to your list, publish it on the web. About $0.10 per 1,000 emails.

This fork runs its whole backend on one [Neon](https://neon.com) project: Lakebase Postgres for the data, a Neon Function with a cron trigger for background sending and scheduling, Neon Object Storage for editor images, and the Neon AI Gateway for subject line ideas. Every Neon branch gets its own copy of all four.

![Mailcheap overview](docs/screenshots/overview.webp)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Frishi-raj-jain%2Fmailcheap&project-name=mailcheap&repository-name=mailcheap&env=DATABASE_URL,ADMIN_EMAIL,ADMIN_PASSWORD,SESSION_SECRET&envDescription=Neon%20database%2C%20login%20and%20signing%20secret.%20ADMIN_PASSWORD%20needs%2012%2B%20characters%2C%20SESSION_SECRET%2032%2B%20%28run%3A%20openssl%20rand%20-base64%2048%29.%20Add%20SES%20and%20the%20sender%20function%20after%20the%20first%20deploy.&envLink=https%3A%2F%2Fgithub.com%2Frishi-raj-jain%2Fmailcheap%23environment-variables)

> [!IMPORTANT]
> **No support.** This is a one-time open-source release. Issues are off, and setup questions go unanswered. Fork it, deploy it, make it yours.

## Why

Newsletter platforms charge for every subscriber, every month. With your own SES account you pay for the emails you send: 10,000 readers and 4 issues a month is 40,000 emails, about $4.

Mailcheap is the rest of what a newsletter needs, in one small Next.js app: an editor, a list, signup forms, unsubscribe handling, bounce and complaint handling, stats and a public archive. One admin, no teams, no plans. Your list stays in your database.

## Features

**Write and send**

- Editor with an email preview that updates as you type, slash commands, image uploads and boxes. Markdown and raw HTML work too.
- Subject line and preview text ideas from the Neon AI Gateway, written from the issue itself.
- Checks before every send: subject, preview text, unsubscribe link, size under Gmail's 100 KB clip, postal address, verified domain.
- Test emails, scheduling, and sending in batches through a Neon Function at the rate you set.
- Send in steps: start with your most engaged readers, then send to more.

**Grow the list**

- Several newsletters in one install, each with its own from address, reply-to and postal address.
- A signup form on each newsletter's archive, and a signup API with API keys.
- Confirmed opt-in per newsletter, off by default. Welcome email.
- Rate limits on signups, login, unsubscribes and the API, on by default.

**Keep it healthy**

- SES events (deliveries, bounces, complaints) and a suppression list shared by every newsletter.
- A send pauses itself when bounces pass 2% or complaints pass 0.08%.
- One-click unsubscribe (RFC 8058 `List-Unsubscribe` headers) and an unsubscribe page, with signed links.
- List cleanup, off by default: readers who ignored several issues get one "do you still want this?" email, then stop getting issues.
- Open and click tracking on your own domain, with link scanners filtered out.

**Publish and measure**

- A public archive for each newsletter: issue pages, author page, share images, sitemap. Optional custom domain.
- Overview with subscribers over time, emails per hour, and delivery, open, click, bounce and complaint rates.
- Campaign reports by mailbox provider (Gmail, Outlook, Yahoo, iCloud...).
- Contacts with search, status filters and CSV import from any platform.
- A domains page with each SES identity's DKIM and MAIL FROM status and the DNS records to add.

## Screenshots

| Editor | Campaign report |
| --- | --- |
| ![Editor](docs/screenshots/editor.webp) | ![Campaign report](docs/screenshots/report.webp) |
| **Contacts** | **Public archive** |
| ![Contacts](docs/screenshots/contacts.webp) | ![Public archive](docs/screenshots/archive.webp) |

<details>
<summary>Issue page</summary>

![Issue page](docs/screenshots/issue.webp)

</details>

All names and addresses in the screenshots are made up.

## What you need

| Service | For | Cost |
| --- | --- | --- |
| [Neon](https://neon.com) Lakebase Postgres | Contacts, campaigns, stats, rate limits | Free plan works |
| [Neon Functions](https://neon.com/docs/compute/functions/overview) + Function Triggers | Background sending and scheduling (replaces QStash) | Included with the project |
| [Neon Object Storage](https://neon.com/docs/storage/overview) (optional) | Image uploads in the editor (replaces Vercel Blob) | Included with the project |
| [Neon AI Gateway](https://neon.com/docs/ai-gateway/overview) (optional) | Subject line ideas | Paid Neon plan plus [AI Gateway credits](https://neon.com/docs/ai-gateway/prepaid-credits) |
| [Amazon SES](https://aws.amazon.com/ses/) or [Resend](https://resend.com) | Sending | SES: about $0.10 per 1,000 emails. Resend: free tier, then a monthly plan |
| [Vercel](https://vercel.com) or any Node.js host | Hosting the dashboard and archive | Free tier works |

Functions, Object Storage and the AI Gateway are available in `aws-us-east-1`, `aws-us-east-2`, `aws-eu-central-1` and `aws-ap-southeast-1`. Create the Neon project in one of them.

Rate limits are counted in Postgres, so every server instance shares them. If the database doesn't answer, Mailcheap counts the same limits in each instance's memory until it does.

Without Object Storage, image uploads in the editor are off. HTML and Markdown campaigns can still use images hosted anywhere. Without the AI Gateway, the ideas button is hidden.

## Setup

Plan for about an hour, most of it waiting for DNS and for AWS to approve production access.

### 1. Neon

Install the [Neon CLI](https://neon.com/docs/cli/install) (`npm i -g neon`) and sign in with `neon login`. Then, in your clone:

```bash
npm install
neon link --project-name mailcheap --region-id aws-us-east-2   # creates the project and pulls DATABASE_URL into .env.local
npm run db:migrate                                              # creates the tables
```

Add `ADMIN_EMAIL`, `SESSION_SECRET`, `SENDER_SECRET` (`openssl rand -base64 32`) and `APP_URL` (your production URL) to `.env.local`, then deploy the rest of the backend that [`neon.ts`](neon.ts) declares:

```bash
npm run sender:deploy   # neon deploy --env .env.local
```

That creates the `mailcheap-images` bucket, turns on the AI Gateway, deploys the `sender` function with the settings it reads from `.env.local`, and adds the `sender-tick` cron trigger that calls it every minute. It also writes the new credentials to `.env.local`. Run it again whenever you change a setting the sender reads (`SENDING_ENABLED`, the SES keys, `APP_URL`...).

On the Free plan, remove `aiGateway: true` from `neon.ts` first: the gateway needs a paid plan.

### 2. Deploy

1. Click **Deploy** above.
2. Fill in `DATABASE_URL` (from `.env.local`), `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 12 characters) and `SESSION_SECRET` (at least 32; generate it with `openssl rand -base64 48`). With shorter ones, Mailcheap refuses to start and the logs say which one to fix.
3. Open `https://<your-project>.vercel.app/login` and log in.

Sending is off until you finish the next steps, so nothing can go out by mistake. On any other Node.js host: `npm ci && npm run build && npm start`, with the same variables, behind HTTPS.

If you plan to use your own domain for the dashboard (like `mailcheap.example.com`), add it in Vercel now and set `APP_URL` to it. Links in your emails use `APP_URL`, so it should be final before your first send.

### 3. Amazon SES

Sending through Resend instead? Skip to [3b. Resend](#3b-resend).

Use one AWS region for everything below (the examples use `us-east-1`).

1. **Verify a sending domain.** In the SES console, go to **Identities > Create identity > Domain**. Use a subdomain like `mail.example.com`, so your main domain's email is unaffected. Keep Easy DKIM with RSA 2048 and add the 3 CNAME records SES gives you at your DNS provider.
2. **Set a custom MAIL FROM domain.** On the identity, open **Custom MAIL FROM domain > Edit**, use `bounce.mail.example.com`, and add the MX and TXT records SES shows. This aligns SPF with your domain.
3. **Add DMARC** if your root domain doesn't have one: a TXT record at `_dmarc.example.com` with `v=DMARC1; p=none;` to start. Gmail and Yahoo require DMARC from bulk senders.
4. **Request production access.** New accounts are in the sandbox (200 emails a day, verified recipients only). In **Account dashboard > Request production access**, pick Marketing, and explain that readers opt in, that bounces and complaints are suppressed automatically, and that every email has one-click unsubscribe. AWS usually answers within a day.
5. **Create a configuration set**, named `mailcheap` for example, under **Configuration sets**. Leave SES open and click tracking off: Mailcheap tracks on your own domain.
6. **Create an SNS topic.** In the SNS console, create a standard topic, like `mailcheap-ses-events`, and copy its ARN. Then switch it to signature version 2, which signs messages with SHA256 instead of SHA1: `aws sns set-topic-attributes --topic-arn <topic-arn> --attribute-name SignatureVersion --attribute-value 2`.
7. **Send SES events to the topic.** In the configuration set, open **Event destinations > Add destination**. Select hard bounces, complaints, deliveries, delivery delays, rejects and rendering failures, then pick Amazon SNS and your topic.
8. **Create an IAM user for Mailcheap** with this policy, then create an access key for it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail"],
      "Resource": [
        "arn:aws:ses:us-east-1:<account-id>:identity/mail.example.com",
        "arn:aws:ses:us-east-1:<account-id>:configuration-set/mailcheap"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["ses:GetAccount", "ses:ListEmailIdentities", "ses:GetEmailIdentity"],
      "Resource": "*"
    }
  ]
}
```

9. **Add the variables in Vercel** and redeploy: `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_CONFIGURATION_SET` and `SES_SNS_TOPIC_ARN`.
10. **Subscribe Mailcheap to the topic.** In the SNS topic, **Create subscription** with protocol HTTPS and endpoint `https://<your-app>/api/webhooks/ses`. Leave raw message delivery off. Mailcheap confirms the subscription by itself; refresh and the status turns to Confirmed.

The **Domains** page in Mailcheap now shows your domain with its DKIM and MAIL FROM status. Optional: in SES **Account dashboard > Suppression list**, turn on the account-level list for bounces and complaints too.

### 3b. Resend

Use this instead of step 3 to send through [Resend](https://resend.com).

1. **Add and verify a sending domain** at [resend.com/domains](https://resend.com/domains), ideally a subdomain like `mail.example.com`. Turn **open tracking** and **click tracking** off on the domain: Mailcheap tracks on your own domain.
2. **Create an API key** with **Full access** at [resend.com/api-keys](https://resend.com/api-keys). Sending-only keys can't read domains, so the Domains page and the pre-send domain check would fail.
3. **Add a webhook** at [resend.com/webhooks](https://resend.com/webhooks) for the events `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`, `email.failed` and `email.suppressed`. Point it at the sender function, `<NEON_FUNCTION_SENDER_BASE_URL>/webhooks/resend`, or at the app, `https://<your-app>/api/webhooks/resend`. Both run the same handler. Copy its signing secret.
4. **Add the variables** to `.env.local` and to Vercel: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`. Then run `npm run sender:deploy` and redeploy Vercel.

Resend allows 10 API requests per second per team by default, so Mailcheap sends 8 emails per second unless you set `SEND_RATE_PER_SECOND` (up to 100, after Resend raises your limit). Every send carries Mailcheap's message id as its idempotency key, so a retried request never sends twice. Bounces, complaints and Resend's own suppressions update the message, the campaign stats and the shared suppression list, exactly like SES events.

### 4. The sender function

The `sender` Neon Function sends queued emails through SES next to the database, and starts scheduled sends. The dashboard wakes it right after you press Send, and the `sender-tick` cron trigger runs it every minute, so a send never waits more than a minute even if that wake-up is lost.

1. Add the SES or Resend variables from step 3 to `.env.local` too, and run `npm run sender:deploy` again so the function has them.
2. In Vercel, add `SENDER_SECRET` (the same value as in `.env.local`) and `SENDER_URL` (the `NEON_FUNCTION_SENDER_BASE_URL` from `.env.local`), then redeploy.
3. For editor images, also add `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_ENDPOINT_URL` and `STORAGE_REGION` with the values of the `AWS_*` keys in `.env.local` (Vercel reserves the `AWS_*` names). For subject ideas, add `NEON_AI_GATEWAY_BASE_URL` and `NEON_AI_GATEWAY_TOKEN`.

The function checks `SENDER_SECRET` on every wake-up, and Neon's trigger header on every cron call. It calls `APP_URL/api/revalidate` after it starts a scheduled send, so archive pages refresh. Its logs: `neon logs query --source function --since 1h`.

### 5. Turn sending on

1. In Mailcheap, create a newsletter. The from address must be on your verified domain, and the postal address shows in every email's footer (anti-spam laws require one).
2. Set `SENDING_ENABLED=true` in Vercel and in `.env.local`, then redeploy both (Vercel, and `npm run sender:deploy`).
3. Write a campaign, send yourself a test, then send. For a new domain, set a limit to reach your most engaged readers first, and use **Send to more** on the report once the first step looks healthy.

### Optional

- **Archive on its own domain:** add the domain to your Vercel project, then set `ARCHIVE_HOSTS=news.example.com=<newsletter-slug>` and redeploy. That domain serves only the archive and the unsubscribe page, never the dashboard, and the app domain's `/archive/<newsletter-slug>` pages redirect there.

  This is the safer setup: issue pages show HTML from your editor and from API keys, and on their own domain that HTML never shares the dashboard's origin. Without one, the archive stays on the app domain, where the sanitizer, the sandboxed frame and the Content Security Policy protect it.
- **Preview branches:** `neon checkout preview-x --create --env .env.local` gives a branch its own database copy, bucket, gateway and sender function at their own URLs, from the same `neon.ts`.
- **Alerts:** set `ALERT_FROM` (like `Mailcheap <alerts@mail.example.com>`) to get alerts by email at `ADMIN_EMAIL`: spam complaints, paused sends, signup floods and rate limiter outages, plus every login, new API key and send. Otherwise they only show in the logs.

## Local development

```bash
git clone https://github.com/<you>/mailcheap.git && cd mailcheap
npm install
neon checkout dev --create   # a Neon branch of your own, with its DATABASE_URL in .env.local
npm run db:migrate
npm run dev
```

Before `npm run dev`, add `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET` and `SENDER_SECRET` to `.env.local` ([`.env.example`](.env.example) explains each one).

- Sending stays off locally unless you set `SENDING_ENABLED=true`. With SES, set the `SES_*` keys locally too: the `AWS_*` keys in `.env.local` are the Neon Object Storage ones. Resend needs only `RESEND_API_KEY`.
- Without `SENDER_URL` or `NEON_FUNCTION_SENDER_BASE_URL`, the dev server sends queued emails itself after you press Send. `npm run sender:dev` (`neon dev`) serves the function on your machine instead. Simulate a cron tick with the `curl` in the [Function Triggers docs](https://neon.com/docs/cli/triggers).
- `npm run db:generate` writes a migration after a change to [`lib/schema.js`](lib/schema.js), and `npm run db:migrate` applies it.
- `npm test` runs the unit tests and `npm run lint` runs ESLint.

## Deliverability basics

- **Send from a subdomain** (`mail.example.com`), so a bad week doesn't affect your main domain's email.
- **Authenticate everything:** DKIM (Easy DKIM), SPF through the custom MAIL FROM domain, and DMARC on the root domain.
- **Only email people who asked.** Never import a bought or scraped list. If bots fill your forms, turn on confirmed opt-in.
- **Warm up a new domain.** Send to your most engaged readers first, and grow each send over a few weeks.
- **Watch complaints and bounces.** Keep complaints under 0.1% and bounces under 2%. Mailcheap pauses a send above 0.08% complaints or 2% bounces. Add your domain to [Google Postmaster Tools](https://postmaster.google.com) to see your spam rate at Gmail.
- **Make leaving easy.** Every email has one-click unsubscribe headers and a footer link, which Gmail and Yahoo require.
- **Clean your list.** Turn on list cleanup in each newsletter's settings to stop emailing people who never open.
- **Keep emails under 100 KB**, or Gmail clips them and hides the unsubscribe link.

## Environment variables

| Variable | Required | What it does |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Pooled Lakebase Postgres connection string of the Neon branch |
| `ADMIN_EMAIL` | Yes | Dashboard login, and where test emails and alerts go |
| `ADMIN_PASSWORD` | Yes | Dashboard password, 12+ characters. Changing it signs out every session. |
| `SESSION_SECRET` | Yes | Signs sessions and email links. 32+ random characters. Changing it breaks links in sent emails. |
| `APP_URL` | On other hosts | Public URL of the app. On Vercel it defaults to the production domain. |
| `SENDING_ENABLED` | To send | Nothing is sent unless it's `true` |
| `EMAIL_PROVIDER` | No | `ses` or `resend`. Without it, `RESEND_API_KEY` picks Resend, otherwise SES. |
| `RESEND_API_KEY` | To send with Resend | Full access API key |
| `RESEND_WEBHOOK_SECRET` | To send with Resend | Signing secret of the Resend webhook (`whsec_...`) |
| `SES_REGION` | To send with SES | SES region, `us-east-1` by default |
| `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` | To send with SES | IAM user keys |
| `SES_CONFIGURATION_SET` | To send with SES | Configuration set that publishes events to SNS |
| `SES_SNS_TOPIC_ARN` | To send with SES | SNS topic Mailcheap accepts at `/api/webhooks/ses` |
| `SENDER_SECRET` | To send campaigns | Shared by the app and the sender function. 32+ random characters. |
| `SENDER_URL` | On Vercel | The sender function's URL (`NEON_FUNCTION_SENDER_BASE_URL` in `.env.local`) |
| `SEND_RATE_PER_SECOND` | No | Emails per second. SES: 1 to 14 (default 10). Resend: 1 to 100 (default 8). |
| `ARCHIVE_HOSTS` | No | Archive domains, like `news.example.com=weekly,letters.example.org=monthly` |
| `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_ENDPOINT_URL`, `STORAGE_REGION` | No | Image uploads on Vercel (locally, the `AWS_*` keys from `neon deploy`) |
| `NEON_AI_GATEWAY_BASE_URL`, `NEON_AI_GATEWAY_TOKEN` | No | Subject line ideas (written by `neon deploy`) |
| `AI_MODEL` | No | Gateway model for subject ideas (default `claude-sonnet-5`) |
| `ALERT_FROM` | No | From address for alert emails, on a verified domain |

[`.env.example`](.env.example) has the same list with more detail.

## API

Create a key on the **API keys** page and send it as `Authorization: Bearer <key>`.

**Add a contact**: `POST /api/v1/contacts`

```bash
curl -X POST https://<your-app>/api/v1/contacts \
  -H "Authorization: Bearer $MAILCHEAP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"newsletter":"weekly","email":"jane@example.com","source":"website","ip":"203.0.113.7"}'
```

- `newsletter` (slug) and `email` are required. `source` labels where the signup came from.
- `resubscribe: true` brings back someone who unsubscribed (never someone who bounced or complained).
- Pass your visitor's IP as `ip` to get the per-visitor limit of 5 signups per 10 minutes. Each key is also limited to 600 signups an hour.
- Answers `201` for a new contact, `200` if it already existed, with `{ id, status, created }`. When the newsletter confirms signups, `status` is `pending` and `inbox` links to the reader's email provider for your "check your inbox" message.

**Create a draft**: `POST /api/v1/campaigns` with `newsletter`, `subject`, `previewText` (optional), `html` or `markdown`, and `archiveSlug` (optional). Answers `201` with the draft's id and dashboard URL. Sending stays a click in the dashboard.

**List sent issues**: `GET /api/v1/campaigns?newsletter=<slug>` returns each issue's id, subject, preview text, archive URL and send date.

## How it works

- Next.js App Router, JavaScript, Tailwind CSS with shadcn/ui, Lakebase Postgres through Drizzle ORM and the Neon serverless HTTP driver. [`neon.ts`](neon.ts) declares the rest of the backend.
- **Send** picks the audience (active contacts, suppressions left out, most engaged first) and creates one queued message per reader. The `sender` Neon Function takes a lease so only one copy runs, then sends the queue in batches of 50 through the SES v2 API at `SEND_RATE_PER_SECOND`, for up to 12 minutes per run, and pauses the campaign if bounce or complaint rates pass the limits.
- **Scheduling** is a status and a time on the campaign. The `sender-tick` cron trigger starts every send that is due.
- Welcome and confirmation emails go out right away, capped at 100 every 10 minutes per newsletter.
- SES publishes events to SNS, which posts them to `/api/webhooks/ses`. Mailcheap verifies the SNS signature, updates the message, the campaign stats and the contact, and suppresses bounced and complaining addresses for every newsletter.
- With Resend, a signed webhook (Svix signatures, checked against `RESEND_WEBHOOK_SECRET`) brings the same events to `/webhooks/resend` on the sender function or `/api/webhooks/resend` on the app, and Mailcheap applies them the same way.
- Opens and clicks go through `/o/...` and `/c/...` on your app's domain. Clicks within 30 seconds of the send, or from known link scanners, don't count.
- Archive pages are static and refresh when you send or save.

## Support

There's none: issues are off and pull requests may not be reviewed. This is a one-time release, with no updates planned. See [SECURITY.md](SECURITY.md) for what's built in.

## License

[MIT](LICENSE). Made by [Marc Lou](https://x.com/marclou).
