<p align="center">
  <a href="https://mailcheap.ai">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
      <img src="docs/logo.svg" alt="MailCheap" width="64" height="64">
    </picture>
  </a>
</p>

<h1 align="center">MailCheap</h1>

<p align="center">
  Newsletters where you pay for the emails you send, not for dormant subscribers.<br>
  A fraction of the price of beehiiv and the like.
</p>

<p align="center">
  <a href="https://mailcheap.ai">Website</a> ·
  <a href="https://mailcheap.ai/docs">API docs</a> ·
  <a href="https://mailcheap.ai/signin">Sign up for MailCheap Cloud</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/github/license/marclou/mailcheap?color=blue"></a>
  <a href="#self-hosting"><img alt="Node.js 22 or later" src="https://img.shields.io/badge/node-22%2B-339933?logo=nodedotjs&logoColor=white"></a>
  <a href="https://mailcheap.ai/docs/mcp"><img alt="MCP server" src="https://img.shields.io/badge/MCP-server-0a0a0a"></a>
</p>

![MailCheap's overview: emails sent, delivery, open, click, bounce and complaint rates, and subscribers over the last 30 days](docs/screenshots/overview.webp)

MailCheap is a newsletter app: write an issue, send it to your list, publish it on the web, from the dashboard or from your AI agent. This repository is the whole app. Self-host it with your own Amazon SES, PostShiba or SendHQ account, or use [MailCheap Cloud](https://mailcheap.ai), which runs this same code.

## Features

- **AI agents and the dashboard.** Everything the dashboard does also works from an AI agent through the MCP server, and from code through the REST API, with the same checks and limits. ChatGPT, Claude and Grok Bot connect with OAuth; Claude Code, Codex and Cursor with an API key. MCP marks sending as an action that can't be undone, so agents ask you first.
- **Write, review, send.** Write in an editor with slash commands, images and boxes, or send Markdown or a complete HTML email through the API and MCP. Review shows what to fix before sending: subject, preview text, unsubscribe link, Gmail's 100 KB clip, postal address, sender. Then send it, schedule it, or start with your most engaged readers and send to more later.
- **Imports from beehiiv, Substack and Mailchimp.** Their CSV exports import as they are, with each reader's status and signup date, and so do Kit's, MailerLite's, Buttondown's, Ghost's and EmailOctopus's.
- **A website for each newsletter**, on a free subdomain on MailCheap Cloud (`<slug>.mailcheap.ai`), or on your server: every issue gets a page search engines can find, with a signup form, an author page, share images and a sitemap.
- **Sending from your own domain**, with the DKIM, return path and DMARC records to add and a check for each. On MailCheap Cloud, a newsletter without a domain sends from its own shared address, `hello@<slug>.mailcheap.ai`.
- **Deliverability protections**, built in:
  - sending pace: contacts the account never emailed go out in steps, a random 2% first, then 5% more, then the rest, 30 minutes apart while their bounces and complaints stay low. On MailCheap Cloud, a domain new to Gmail also sends to its first 2,000 Gmail readers on its first day and to the others the next day;
  - list cleanup, on by default: readers who ignored several issues get one "do you still want this?" email, then stop getting issues;
  - contact cleaning: imports leave out invalid, misspelled (gmial.com), spam trap, role, throwaway and duplicate addresses, domains that can't receive email, and anyone who unsubscribed, bounced or complained before;
  - one never-email list for the whole server: an address the email provider says doesn't exist (for 180 days) or that turned out to be a spam trap (for good) is left out of every account's imports, signups and sends, and only a keyed hash of it is kept;
  - spam and bounce limits: a send pauses past 2.5% hard bounces or 0.08% complaints, and the account is blocked past 5% or 0.3%, or on a spam trap hit;
  - Gmail's spam rates, which Gmail never reports one complaint at a time: every email carries a `Feedback-ID` for Gmail's feedback loop (its campaign or newsletter, its account, its kind), and once an admin connects [Google Postmaster Tools](https://postmaster.google.com), MailCheap reads it every day. An account Gmail flags at 0.08% has its sends paused, at 0.3% it's blocked, and the admins hear when the whole domain reaches 0.1%;
  - one-click unsubscribe (RFC 8058) and a signed unsubscribe link in every email, and confirmed opt-in, on by default.
- **Several newsletters**: up to 3 per account, each with its own contacts, campaigns and website.
- **Signups and stats**: signup forms and a signup API, welcome emails, open and click tracking that leaves link scanners out, subscribers over time, and reports by inbox provider (Gmail, Outlook, Yahoo, iCloud...).

| Write, review, send | The newsletter's website |
| --- | --- |
| ![The campaign editor's Write step: the subject, preview text and body of a draft, with the Write, Review and Send steps at the top](docs/screenshots/editor.webp) | ![A newsletter's website: its signup form, a featured issue and the latest issues](docs/screenshots/website.webp) |

All names and addresses in the screenshots are made up.

## MailCheap Cloud or self-hosted

| | [MailCheap Cloud](https://mailcheap.ai) | Self-hosted |
| --- | --- | --- |
| Price | From $19 a month for 20,000 emails | Free, plus what your provider charges per email: $0.10 to $0.16 per 1,000 on Amazon SES |
| Sending | Set up for you, from `hello@<slug>.mailcheap.ai` or your domain | Your Amazon SES, PostShiba or SendHQ account, from your domain |
| Website | `<slug>.mailcheap.ai` | `/archive/<slug>` on your server's domain |
| Who signs in | Anyone who signs up | The emails you allow |
| Limits | Emails a month and active subscribers, by plan | None |
| Setup | A few minutes | About an hour, most of it waiting for DNS and production access |
| Support | A chat in the dashboard | None: issues are off |

MailCheap Cloud is this repository with `MAILCHEAP_CLOUD=true`, which adds open sign-up, plans and Stripe billing. Only active subscribers count toward a plan, not the ones list cleanup marked dormant. Its marketing site (the landing, pricing and legal pages) isn't part of the open source. Every change to the app ships to both.

With your own sending account, you pay your provider for the emails you send: 10,000 readers and 4 issues a month is 40,000 emails, about $4 to $6 on Amazon SES.

## Self-hosting

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmarclou%2Fmailcheap&project-name=mailcheap&repository-name=mailcheap&env=MONGODB_URI,BETTER_AUTH_SECRET,SUPPRESSION_HASH_KEY,ADMIN_EMAILS,EMAIL_FROM&envDescription=Database%2C%20a%20signing%20secret%20and%20a%20hash%20key%20%2832%2B%20characters%20each%3A%20openssl%20rand%20-base64%2048%29%2C%20your%20email%20to%20sign%20in%20with%2C%20and%20the%20from%20address%20of%20sign-in%20codes.%20Add%20RESEND_API_KEY%2C%20or%20set%20up%20SES%20or%20PostShiba%2C%20so%20the%20codes%20can%20reach%20you.&envLink=https%3A%2F%2Fgithub.com%2Fmarclou%2Fmailcheap%23environment-variables)

Plan for about an hour, most of it waiting for DNS and for your provider to approve production sending. Self-hosting comes without support: issues are off and setup questions go unanswered.

### What you need

| Service | For | Cost |
| --- | --- | --- |
| [MongoDB](https://www.mongodb.com/atlas) | Contacts, campaigns, stats | Free tier works |
| [Amazon SES](https://aws.amazon.com/ses/), [PostShiba](https://postshiba.com) or [SendHQ](https://sendhq.cc) | Sending | SES: $0.10 to $0.16 per 1,000 emails, depending on its pricing plan. PostShiba: a fixed price per cluster, invite only for now. SendHQ: monthly plans by volume; newsletters need a marketing plan |
| [Upstash QStash](https://upstash.com/docs/qstash) | Background sending and scheduling | Free tier to start, then pay per message. One message sends 50 emails |
| [Vercel](https://vercel.com) or any Node.js 22+ host | Hosting | Free tier works |
| [Resend](https://resend.com) (optional) | Sign-in codes and alerts. Without it, they go through SES or PostShiba | Free plan works |
| [Upstash Redis](https://upstash.com/docs/redis) (optional) | Rate limits shared by every server instance | Free tier |
| [Amazon S3](https://aws.amazon.com/s3/) with [CloudFront](https://aws.amazon.com/cloudfront/), or [Vercel Blob](https://vercel.com/docs/vercel-blob) (optional) | Image uploads in the editor, the newsletter settings and the API | S3 and CloudFront: pay per use. Blob: free tier |

Without Redis, MailCheap counts the same rate limits in each server instance's memory. That still stops a script hammering a form, but on serverless hosts the limits aren't shared between instances and reset on each deploy. Add Redis before you put a signup form on a busy site. Without S3 or Blob, image uploads are off; HTML and Markdown campaigns can still use images hosted anywhere.

### Environment variables

| Variable | What it does |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string with a database name |
| `BETTER_AUTH_SECRET` | Signs sessions and every link in sent emails. 32+ random characters (`openssl rand -base64 48`), or the server refuses to start. Rotating it signs everyone out and breaks links in emails already sent |
| `SUPPRESSION_HASH_KEY` | Keys the hashes of the never-email list every account shares. 32+ random characters of its own, never `BETTER_AUTH_SECRET`, or the server refuses to start, after an upgrade too. Changing it empties the list |
| `ADMIN_EMAILS` | Comma-separated emails that can sign in and open `/admin` |
| `ALLOWED_EMAILS` | Who else can sign in: addresses and `@domain` entries, comma-separated |
| `EMAIL_FROM` | From address of sign-in codes and alerts, on a domain your Resend account or email provider verified |
| `APP_URL` | Public URL of the app, for email links and sign-in. On Vercel it defaults to the production domain |
| `RESEND_API_KEY` | Optional: sign-in codes and alerts through Resend. Without it, they go through the email provider |
| `SENDING_ENABLED` | Nothing goes to readers unless it's `true`. Sign-in codes and alerts don't wait for it |
| `SES_*`, `POSTSHIBA_*` or `SENDHQ_*` | The email provider, in step 4 |
| `QSTASH_*` | Background sending and scheduling, in step 5 |

[`.env.example`](.env.example) lists every variable with what it does, the optional ones included: Google sign-in and Postmaster Tools, image uploads, Redis, Telegram alerts, the shared domain, and MailCheap Cloud's own.

### 1. Database

1. Create a free cluster on [MongoDB Atlas](https://www.mongodb.com/atlas).
2. **Database Access**: add a user with a password and the "Read and write to any database" role.
3. **Network Access**: allow `0.0.0.0/0`. Vercel doesn't have fixed IP addresses.
4. **Connect > Drivers**: copy the connection string and add a database name before the `?`, like `...mongodb.net/mailcheap?retryWrites=true`. That's your `MONGODB_URI`.

### 2. Deploy

1. Click **Deploy** above.
2. Fill in `MONGODB_URI`, `BETTER_AUTH_SECRET` (at least 32 characters; generate it with `openssl rand -base64 48`), `SUPPRESSION_HASH_KEY` (generated the same way, another value), `ADMIN_EMAILS` (your email) and `EMAIL_FROM` (like `MailCheap <login@mail.example.com>`, on a domain your Resend account or email provider verified). With a short secret, MailCheap refuses to start and the logs say why.
3. Sign-in codes need a way to reach you. The quickest is [Resend](https://resend.com): verify `EMAIL_FROM`'s domain there and add `RESEND_API_KEY`. Without it, codes go through SES or PostShiba once step 4 is done.
4. Open `https://<your-project>.vercel.app/signin` and sign in with your email.

Sending stays off until you finish the next steps, so nothing goes out to readers by mistake. On any other Node.js host: `npm ci && npm run build && npm start`, with the same variables, behind HTTPS. `/api/health` answers 200, or 503 with what to fix.

If you plan to use your own domain for the dashboard (like `mailcheap.example.com`), add it in Vercel now and set `APP_URL` to it. Links in your emails use `APP_URL`, so it should be final before your first send.

### 3. Who can sign in

Only the emails you list: `ADMIN_EMAILS` (who can also open `/admin`) and `ALLOWED_EMAILS`, a comma-separated list of addresses and whole domains, like `jane@example.com, @example.org`. It's checked at every sign-in, with a code or with Google, and anyone you take off the list is signed out and loses their API keys at their next request. With both lists empty, nobody can sign in.

Everyone gets an account of their own, with up to 3 newsletters and their contacts and campaigns, and the account's domains and API keys. There's no billing on a self-hosted server: no plans, no limits.

### 4. Email provider

Pick Amazon SES, PostShiba (invite only for now) or SendHQ. `EMAIL_PROVIDER` picks one; without it, MailCheap uses PostShiba when `POSTSHIBA_API_KEY` is set and SES otherwise. On SES and PostShiba, every account gets its own tenant there, with its own domains, suppression list and pause switch; on SendHQ, every account sends through your one workspace. MailCheap creates them; you set up the provider account and its events once.

#### Amazon SES

Use one AWS region for everything below (the examples use `us-east-1`). An AWS account just for MailCheap is best: SES reputation and limits are per AWS account.

1. **Request production access.** New accounts are in the sandbox (200 emails a day, verified recipients only). In **Account dashboard > Request production access**, pick Marketing, and explain that readers opt in, that bounces and complaints are suppressed automatically, and that every email has one-click unsubscribe. AWS usually answers within a day.
2. **Create an SNS topic** for events, like `mailcheap-ses-events`, and switch it to signature version 2, which signs messages with SHA256 instead of SHA1: `aws sns set-topic-attributes --topic-arn <topic-arn> --attribute-name SignatureVersion --attribute-value 2`. Then **Create subscription** with protocol HTTPS and endpoint `https://<your-app>/api/webhooks/ses`, raw message delivery off. MailCheap confirms the subscription by itself once it's deployed with the variables of step 4.
3. **Create an IAM user for MailCheap** with this policy, then create an access key for it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:GetAccount",
        "ses:CreateTenant",
        "ses:GetTenant",
        "ses:DeleteTenant",
        "ses:TagResource",
        "ses:CreateTenantResourceAssociation",
        "ses:DeleteTenantResourceAssociation",
        "ses:UpdateReputationEntityPolicy",
        "ses:UpdateReputationEntityCustomerManagedStatus",
        "ses:CreateConfigurationSet",
        "ses:CreateConfigurationSetEventDestination",
        "ses:DeleteConfigurationSet",
        "ses:CreateEmailIdentity",
        "ses:GetEmailIdentity",
        "ses:PutEmailIdentityMailFromAttributes",
        "ses:DeleteEmailIdentity"
      ],
      "Resource": "*"
    }
  ]
}
```

4. **Add the variables** and redeploy: `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_AWS_ACCOUNT_ID` (the 12-digit account ID) and `SES_SNS_TOPIC_ARN`. Each account's configuration set publishes its events to that topic.
5. **Optional: tenant pauses.** SES pauses tenants that send badly. To block the account in MailCheap too, send SES's tenant status and reputation finding events from EventBridge to a second SNS topic, subscribe `https://<your-app>/api/webhooks/ses-tenants` to it, and set `SES_TENANT_SNS_TOPIC_ARN`.

Without Resend, sign-in codes and alerts go out through SES from `EMAIL_FROM`, outside every tenant, so its domain has to be verified in the AWS account before your first sign-in: **Identities > Create identity > Domain**, with Easy DKIM. In the sandbox, the addresses you sign in with have to be verified too.

#### PostShiba

PostShiba approves production sending by hand: until then, sends to anyone outside your team answer `kyc_required` (campaigns pause with that reason) and a team can have one cluster.

1. **Team and key.** In API keys, create a full access key: `POSTSHIBA_API_KEY`, with the team id as `POSTSHIBA_TEAM_ID`. Add a payment method (clusters need one).
2. **Clusters.** One `bulk` cluster sends every email: its id goes in `POSTSHIBA_BULK_CLUSTER_ID`. Later, a `transactional` cluster in `POSTSHIBA_TRANSACTIONAL_CLUSTER_ID` takes welcome, confirmation and test emails, so they never wait behind a campaign. Set `SEND_RATE_PER_SECOND` to the bulk cluster's hourly cap divided by 3,600, less what welcome and test emails need when they share it. At a cap, PostShiba answers `throttled`: the batch goes back to the queue and QStash brings it after the hour.
3. **Webhook.** One endpoint for the whole team (no cluster or tenant) at `https://<your-app>/api/webhooks/postshiba` with the events `processed`, `delivered`, `deferred`, `bounce`, `dropped`, `spamreport` and `unsubscribe`. Its secret goes in `POSTSHIBA_WEBHOOK_SECRET`.
4. **Encryption key.** `CREDENTIALS_ENCRYPTION_KEY`, generated once with `openssl rand -base64 32`. It encrypts each tenant's SMTP password, and Postmaster Tools' refresh token.

MailCheap creates the rest: a tenant per account (slug `mc-<accountId>`), an SMTP credential for it on each cluster (one in all on a single cluster), and its domains. Creating credentials and domains and running domain checks share PostShiba's budget of 60 an hour per key; a failed setup is retried at the account's next send.

Without Resend, sign-in codes and alerts go through a tenant of their own, `mc-platform`, on the transactional cluster. The first one adds `EMAIL_FROM`'s domain there, and the server log lists the two CNAME records it needs; once PostShiba finds them, codes go out. A domain belongs to one tenant at PostShiba, so `EMAIL_FROM` needs a domain or subdomain that no newsletter sends from.

#### SendHQ

One SendHQ workspace sends every account's emails. Campaigns go out as marketing email, which needs a marketing plan; welcome, confirmation and test emails go out as transactional.

1. **Key.** Create an API key: `SENDHQ_API_KEY`, and set `EMAIL_PROVIDER=sendhq`.
2. **Rate.** A new workspace's daily volume grows with its sending history. Past it, SendHQ answers 429 and the batch goes back to the queue for an hour. `SEND_RATE_PER_SECOND` paces every email.
3. **Webhook.** At `https://<your-app>/api/webhooks/sendhq`, with the events `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained` and `email.failed`. Its signing secret goes in `SENDHQ_WEBHOOK_SECRET`.

MailCheap adds each domain to the workspace; SendHQ asks for three DKIM CNAME records and keeps the return path on its own domain, so there's no return path record to publish. A domain already in a SendHQ workspace, like `EMAIL_FROM`'s, can't be added: MailCheap only sends from domains it added itself. SendHQ keeps one suppression list for the workspace: an address it suppresses because of another account's email fails that email without becoming the account's own suppression.

Without Resend, sign-in codes and alerts go through the same workspace from `EMAIL_FROM`, so its domain has to be verified there first.

### 5. QStash

1. In the [Upstash console](https://console.upstash.com/qstash), open QStash and copy `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` (and `QSTASH_URL` if you picked a region other than the default).
2. Add them and redeploy.

QStash calls `APP_URL/api/jobs/...` to send each batch, so the app has to be reachable on the internet. MailCheap checks QStash's signature on every job.

### 6. Turn sending on

1. In MailCheap, open **Domains** and add the domain your newsletter sends from. Use a subdomain like `mail.example.com`, so your main domain's email is unaffected. Add the DNS records it lists (DKIM, return path, and DMARC if your root domain has none), set to DNS only if your DNS is on Cloudflare, then click **Check now**.
2. Create your newsletter. The from address must be on that domain, and the postal address shows in every email's footer (anti-spam laws require one).
3. Set `SENDING_ENABLED=true` and redeploy.
4. Write a campaign, send yourself a test, then send. A first send to new contacts goes out in steps by itself; for a new domain, also set a limit to reach your most engaged readers first, and use **Send to more** on the report once the first step looks healthy.

### Optional

- **Google sign-in.** Create an OAuth client (web application) with the redirect URI `<APP_URL>/api/auth/callback/google`, then set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The allowlist applies, and a Google sign-in joins an existing user only when Google verified that email.
- **Gmail's spam rates (Google Postmaster Tools).** It needs the Google sign-in client above, `CREDENTIALS_ENCRYPTION_KEY` and `CRON_SECRET`; without them, or until someone connects, nothing runs.
  1. In the client's Google Cloud project, enable the **Gmail Postmaster Tools API**, and add `<APP_URL>/api/admin/postmaster/callback` to the client's authorized redirect URIs. Its consent screen has to be published (In production): in Testing, Google expires the connection after 7 days.
  2. At [postmaster.google.com](https://postmaster.google.com), add the domain every email is DKIM-signed with: `SHARED_DOMAIN`, which PostShiba's primary domain signing adds to every email, or `POSTMASTER_DOMAIN`. A domain the same Google account verified in Search Console is verified already.
  3. On `/admin`, under **Gmail spam rates**, click **Connect** and allow access with that Google account. Google warns that it hasn't verified the app: it's your own, continue. MailCheap asks for read access to traffic statistics only, and stores the refresh token encrypted with `CREDENTIALS_ENCRYPTION_KEY`.

  Vercel Cron then runs `/api/cron/postmaster` every day (`vercel.json`); elsewhere, have a scheduler call it with `Authorization: Bearer <CRON_SECRET>`. It acts on the newest day of Gmail's data once, with the thresholds in `POSTMASTER` (`lib/config.js`). Gmail only reports domains that send to at least 50 Gmail users a day, and a feedback ID once it has enough emails and spam reports, so until then it finds nothing and says nothing. If Google refuses the connection, one alert says so. Every email's `Feedback-ID` is `<campaign or newsletter id>:mc-<accountId>:<kind>:mailcheap` (`lib/sending-rules.js`): SES sends it as it is, and PostShiba writes its own in its place, also led by `mc-<accountId>`, so each ID maps back to its account (`lib/postmaster-rules.js`).
- **Image uploads.** The quickest is Vercel Blob: in Vercel, **Storage > Create > Blob**, connect it to the project, and redeploy. To serve images from a subdomain of your own (like `cdn.example.com`), put an S3 bucket behind CloudFront. It takes over new uploads, and images already on Blob keep their URLs:
  1. Create a private S3 bucket with Block Public Access on.
  2. In ACM, request a certificate for the subdomain in `us-east-1`, validated by DNS. If your domain has CAA records, add `0 issue "amazon.com"`.
  3. Create a CloudFront distribution: the bucket as origin through Origin Access Control (add the bucket policy CloudFront gives you), viewer protocol HTTPS only, the CachingOptimized cache policy, and the subdomain as alternate domain name with that certificate. Point the subdomain at the distribution with a CNAME.
  4. Create an IAM user for MailCheap with this policy, then an access key for it. Deleting an account deletes its images and clears them from CloudFront's cache, hence `s3:DeleteObject` and `cloudfront:CreateInvalidation`:

     ```json
     {
       "Version": "2012-10-17",
       "Statement": [
         {
           "Effect": "Allow",
           "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
           "Resource": "arn:aws:s3:::<bucket>/accounts/*"
         },
         {
           "Effect": "Allow",
           "Action": ["cloudfront:CreateInvalidation"],
           "Resource": "arn:aws:cloudfront::<aws-account-id>:distribution/<distribution-id>"
         }
       ]
     }
     ```

  5. Set `IMAGES_S3_BUCKET`, `IMAGES_S3_REGION`, `IMAGES_S3_ACCESS_KEY_ID`, `IMAGES_S3_SECRET_ACCESS_KEY`, `IMAGES_CDN_URL` (like `https://cdn.example.com`) and `IMAGES_CLOUDFRONT_DISTRIBUTION_ID` (the distribution's ID), and redeploy. Builds read `IMAGES_CDN_URL` too.

  Each image gets a name that never changes and `Cache-Control: public, max-age=31536000, immutable`, so CloudFront and browsers keep it for a year. An account's purge invalidates its folder, `/accounts/<accountId>/*`, on the distribution, so CloudFront stops serving its deleted images.
- **Shared rate limits.** Create a Redis database in the [Upstash console](https://console.upstash.com/redis) and add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
- **Alerts on Telegram.** Every admin alert shows on `/admin`, and the ones an admin can act on are an email to `ADMIN_EMAILS` too. The others only show on `/admin`: an admin's own block, shared addresses waiting for the DNS helper, whose own alert covers them, and the email provider refusing one account's login, unless a second account's is refused within the hour. The ones that need someone (an automatic account block, the email provider refusing MailCheap's sends, holding a tenant or refusing a customer's own domain, Gmail's spam rate for the domain reaching 0.1% or Postmaster Tools refusing the connection, sign-in codes, Stripe events, webhooks or background jobs failing, QStash refusing jobs, shared addresses and the DNS helper) can reach Telegram too: create a bot with [@BotFather](https://t.me/BotFather), send it a message, and set `TELEGRAM_BOT_TOKEN` and the chat's id as `TELEGRAM_CHAT_ID`. Each alert goes there at most once every 6 hours. A customer with a plan whose emails the provider refuses (a domain it suspended or holds, or their sending space) can't fix it from their dashboard: each campaign it pauses, and each newsletter whose signup or test emails it refuses, alerts, and `/admin` lists them first in Needs a look, in red, with blocked accounts that have a plan. Replies to the owner's own email about such a refusal, or about their account's block, go to `URGENT_REPLY_TO` when it's set, an admin's own inbox. On PostShiba, have a scheduler call `/api/cron/hourly` every hour with `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends it once `CRON_SECRET` is set): it checks the team's status (a suspension, the approval, clusters at their cap, held tenants) and the sending domains it suspended or holds that a customer with a plan sends from, and alerts on what stops sending, and looks at each verified sending domain's DNS records once a day, so a record that's gone or behind a proxy stops that domain and emails its owner. It also ends the imports whose upload stopped, a browser closed halfway, and their owners see it in the dashboard's notifications. Its first run with Telegram set up posts "Telegram alerts are on".
- **Shared domain.** `SHARED_DOMAIN` is how MailCheap Cloud gives every newsletter without a domain of its own an address, `hello@<slug>.SHARED_DOMAIN`, and its website at `<slug>.SHARED_DOMAIN`. MailCheap adds each subdomain at the provider and has its records published, and removed when the slug changes, by a DNS helper (`DNS_BROKER_URL`, `DNS_BROKER_SECRET`): on MailCheap Cloud a Vercel project of its own that holds the Vercel token, so the app never does, and only writes a shared address's records and puts website domains on the app's project. The helper isn't part of this repository, and without one DNS automation is off and shared addresses can't be set up. Its DNS has to be on Vercel, with `*.SHARED_DOMAIN` on the project. Add one DMARC record for the whole domain yourself: `_dmarc.SHARED_DOMAIN` TXT `v=DMARC1; p=none;`. It can be the app's own domain, as MailCheap Cloud's is `mailcheap.ai`: slugs can't take `www` or the other names in `lib/reserved-slugs.js`, and those hosts never open a website.
- **Websites on your own domains.** Set `ARCHIVE_CNAME_TARGET` to the host your server answers on (`cname.vercel-dns.com` on Vercel), and each newsletter's Website settings offer a subdomain of your own, like `news.example.com`. Add that subdomain to your Vercel project (or your web server) first, then add it in MailCheap with the TXT record it shows: once its CNAME and the TXT record are found, the website and the links in the newsletter's next emails move there.

### Sending well

- **Send from a subdomain** (`mail.example.com`), so a bad week doesn't affect your main domain's email.
- **Authenticate everything:** DKIM, SPF through the custom return path, and DMARC on the root domain.
- **Only email people who asked.** Never import a bought or scraped list. If bots fill your forms, keep confirmed opt-in on.
- **Warm up a new domain.** Send to your most engaged readers first, and grow each send over a few weeks.
- **Watch complaints and bounces.** Keep complaints under 0.1% and bounces under 2%. MailCheap pauses a send past 0.08% complaints or 2.5% bounces, and blocks the account past 0.3% complaints or 5% bounces. Gmail only shows its spam rate in [Google Postmaster Tools](https://postmaster.google.com): connect it on `/admin` and MailCheap holds each account to the same levels there.
- **Make leaving easy.** Every email has one-click unsubscribe headers and a footer link, which Gmail and Yahoo require.
- **Clean your list.** Keep list cleanup on to stop emailing people who never open. New newsletters start with it on.
- **Keep emails under 100 KB**, or Gmail clips them and hides the unsubscribe link.

<details>
<summary><b>Billing, as on MailCheap Cloud</b></summary>

<br>

`MAILCHEAP_CLOUD=true` is what [mailcheap.ai](https://mailcheap.ai) runs with: sign-up open to anyone, a newsletter setup at `/welcome` right after sign-in, a dashboard to try before paying with a paywall on sending, imports, domains and API keys, plan limits, and MailCheap's own emails through Resend only. It refuses to start without `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `RESEND_API_KEY`, and `/api/health` answers 503 with the reason, so the cloud can't run without billing by mistake. Set `MAILCHEAP_CLOUD` for builds too: the public pages read it then.

| Plan | Monthly | Yearly | Emails per month | Active subscribers |
| --- | --- | --- | --- | --- |
| Starter | $19 | $190 | 20,000 | 10,000 |
| Growth | $39 | $390 | 75,000 | 40,000 |
| Pro | $79 | $790 | 200,000 | 100,000 |
| Scale | $149 | $1,490 | 500,000 | 250,000 |
| Max | $349 | $3,490 | 2,000,000 | 1,000,000 |
| Ultra | $799 | $7,990 | 5,000,000 | 2,500,000 |

`lib/plans.js` is the one place these live. Yearly plans get the monthly allowance every month of the paid year. Every email counts toward the month: issues, tests, welcome and confirmation emails. Over a limit, campaigns stop with a clear message and an upgrade link; signups and confirmation emails keep going. Welcome emails take room in the month's emails like issues: once they're used up, each one is skipped (its `Message` says why), the owner gets one email that month, and the dashboard says so next to the welcome email, on the overview and on the billing page. They start again when the month resets or the plan grows; the skipped ones aren't sent later. Admin overrides replace a plan's numbers for one account.

Admins can give an account a free plan from `/admin` (the account's menu, **Give a free plan**): any of the six, with an optional end date, without Stripe. It works like a paid plan, its emails start over every month from the day it was given, and the billing page and `get_billing` (REST API and MCP) show it. A plan the account pays for takes over while there's one. **End free plan**, or its end date, stops it like a canceled plan: the data stays and sending stops.

1. **Prices by lookup key.** Create six products (Starter, Growth, Pro, Scale, Max, Ultra), each with a monthly and a yearly recurring USD price, and give every price its lookup key: `mailcheap_<plan>_monthly` and `mailcheap_<plan>_yearly`, like `mailcheap_growth_yearly`. Checkout finds prices by these keys and refuses one whose amount or interval doesn't match `lib/plans.js`, so no price ID goes in the environment. A plan shows on the pricing pages, the paywall, billing and `get_billing` only once Stripe has both of its prices at those amounts: the app reads them every 10 minutes, and the static pages when they're built, so redeploy after adding one.
2. **Webhook.** Add an endpoint at `<APP_URL>/api/webhooks/stripe` with the events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` and `invoice.paid`. Use API version `2026-09-30.endive` (the one `stripe@23` pins) and put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. **Customer Portal.** Turn on payment method updates, invoices, cancellation (at the end of the period) and plan changes between the twelve prices. Charge upgrades at once, with prorations invoiced immediately, and schedule downgrades, a cheaper price or a shorter interval, for the end of the period: otherwise an account can upgrade, send a bigger plan's emails and downgrade before the difference is billed. The billing page's "Switch" buttons open the portal's confirm page for one plan; without plan changes on, they open the portal's home.

Every subscription event re-reads the subscription from Stripe, so events arriving out of order can't leave stale data. Canceled accounts keep their data: sending, signups and the website stop, and everything comes back when they subscribe again.

</details>

## AI agents, REST API and MCP

Create a key on the **API keys** page and send it as `Authorization: Bearer <key>`. A full access key can do everything the dashboard can; a signups only key can only add contacts, for keys that sit in a website's code. Every key gets 300 requests a minute.

**Add a contact**: `POST /api/v1/contacts`

```bash
curl -X POST https://<your-app>/api/v1/contacts \
  -H "Authorization: Bearer $MAILCHEAP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"jane@example.com","source":"website","ip":"203.0.113.7"}'
```

**MCP**: connect Claude Code with a full access key. Every action is a tool.

```bash
claude mcp add --transport http --scope user mailcheap https://<your-app>/mcp \
  --header "Authorization: Bearer $MAILCHEAP_API_KEY"
```

ChatGPT, Claude and Grok Bot add `https://<your-app>/mcp` as a connector or custom MCP server and sign in with OAuth: you sign in to MailCheap and allow the app on a consent page, and it gets full access to that account. The **API keys** page lists connected apps and revokes them. They need the server to be reachable over HTTPS from the internet.

`/docs` on your server has every endpoint, the errors, the MCP setup for ChatGPT, Claude, Grok Bot, Claude Code, Codex and Cursor, and the OpenAPI document at `/api/v1/openapi.json`. On MailCheap Cloud, the same at [mailcheap.ai/docs](https://mailcheap.ai/docs) and `https://mailcheap.ai/mcp`.

## Contributing

Read [AGENTS.md](AGENTS.md) first, whether you're a person or an AI agent: how the app is organized, MailCheap Cloud and self-hosting, the rules (no secrets or personal data in code, tests or commits), code style and tests. [SECURITY.md](SECURITY.md) covers what's built in and the known gaps. Issues are off, and pull requests may not be reviewed.

You need Node.js 22+ and MongoDB:

```bash
git clone https://github.com/marclou/mailcheap.git && cd mailcheap
npm install
cp .env.example .env.local   # set MONGODB_URI, BETTER_AUTH_SECRET, SUPPRESSION_HASH_KEY, ADMIN_EMAILS
npm run dev
```

- Without `MAILCHEAP_CLOUD` it runs as a self-hosted server: sign in with an email in `ADMIN_EMAILS` or `ALLOWED_EMAILS`. Without `RESEND_API_KEY`, development prints the code in the server console (`[signin] Code for ...`); production never does.
- A local MongoDB works: `docker run -d -p 27017:27017 mongo` and `MONGODB_URI=mongodb://127.0.0.1:27017/mailcheap`. A replica set (`mongod --replSet rs0`, then `rs.initiate()`) also gives Better Auth transactions, like Atlas.
- To work on MailCheap Cloud's own parts, set `MAILCHEAP_CLOUD=true` with Stripe test keys and a Resend key: the cloud doesn't start without them. Run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` and use its signing secret as `STRIPE_WEBHOOK_SECRET`.
- Sending stays off unless `SENDING_ENABLED=true`. SES needs `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY`: the app never falls back to `~/.aws` or other default AWS credentials. PostShiba needs its four ids and keys and `CREDENTIALS_ENCRYPTION_KEY`. SendHQ needs `EMAIL_PROVIDER=sendhq`, `SENDHQ_API_KEY` and, for its events, `SENDHQ_WEBHOOK_SECRET`.
- QStash can't reach `localhost`. To try a full send locally, run the QStash dev server (`npx @upstash/qstash-cli dev`) and use the URL, token and signing keys it prints.

Before a pull request, run the full suite, lint and a build:

```bash
npm test       # unit and integration tests
npm run lint
npm run build
```

Integration tests start a throwaway `mongod` per file, so `mongod` has to be on the `PATH` (or set `MONGOD_PATH`). They import server actions and route handlers as they are, and `tests/setup` replaces every outside service with the stubs in `tests/stubs`, so nothing reaches the network. `tests/parity.test.mjs` fails when an action is missing from the REST API, MCP, the OpenAPI document, the docs or the llms files.

## License

[GNU Affero General Public License v3.0](LICENSE). Copyright (C) 2026 Marc Lou.

If you change MailCheap and run it for other people, the AGPL asks you to offer them the source of your version: point the "Source code" link (`SOURCE_URL` in `lib/site.js`) at it. The one-time release before this license, [67d13b0](https://github.com/marclou/mailcheap/tree/67d13b028a6ecae9ec56d49c4b2db58019217eba) in github.com/marclou/mailcheap's history, stays under MIT.

Made by [Marc Lou](https://x.com/marclou).
