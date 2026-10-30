<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# MailCheap

Read this before working on MailCheap. If `AGENTS.cloud.md` is next to it (MailCheap Cloud's own repository), read that too.

## What it is

MailCheap is a newsletter app: write an issue, send it to your list, publish it on the web. Everything the dashboard does also works from an AI agent, through a REST API and an MCP server.

It's open source under the AGPL-3.0 (`LICENSE`): anyone can run it on their own server with their own Amazon SES or PostShiba account, change it and share it. The README is the self-hosting guide. MailCheap Cloud ([mailcheap.ai](https://mailcheap.ai)) runs this same code for people who'd rather not host it.

## How it's organized

Next.js App Router in JavaScript, Tailwind CSS with shadcn/ui, MongoDB through Mongoose, Better Auth for sign-in.

- **Dashboard**: `app/(app)` (overview, campaigns, contacts, newsletters, domains, API keys), `app/(account)` (account, billing), `app/admin`, the sign-in at `app/signin` and the newsletter setup at `app/welcome`.
- **Public pages**: the docs and the help center in `app/(site)`, each newsletter's archive in `app/archive`, and what emails link to (`app/unsubscribe`, `app/confirm`, `app/keep`, tracking in `app/o` and `app/c`). `proxy.js` routes newsletters' own hosts to their archive and only checks that a session cookie is there.
- **Actions**: every customer action is one `defineAction` in `lib/actions/<group>.js` (schemas, permission, handler). `runAction` is the only way to run one: from the dashboard's server actions, the REST API (`app/api/v1`) and MCP (`/mcp`, `lib/mcp/server.js`). The docs, the OpenAPI document and the llms files are generated from the same schemas, and `tests/parity.test.mjs` fails when an action is missing from any of them.
- **Accounts**: `scoped(account, filter)` (`lib/account-scope.js`) adds the account to every query, and a Mongoose plugin refuses customer queries without one. `requireAccount()` for pages and server actions, `authenticateRequest()` for the API and MCP (`lib/auth.js`, `lib/api-keys.js`).
- **MCP and OAuth**: API keys, or OAuth access tokens from Better Auth's OAuth provider (`lib/auth.js`, `lib/oauth.js`, `lib/oauth-rules.js`), with the consent page at `app/oauth/consent`.
- **Jobs**: QStash calls `app/api/jobs/*`: sending batches, scheduled sends, first-send checks, sends resuming after Gmail's rate limit (`lib/send-backoff.js`) and the purge of deleted accounts. A cron calls `app/api/cron/hourly` with `CRON_SECRET`: PostShiba's team status, the daily look at verified sending domains' DNS records (`lib/domain-dns.js`), which stops a domain whose records broke, and the imports that stalled with nobody looking (`lib/import-jobs.js`). Another calls `app/api/cron/postmaster` every day: Gmail's spam rates from Google Postmaster Tools (`lib/postmaster.js`), connected on `/admin`. And `app/api/cron/list-hygiene` every 6 hours: the downloaded domain lists (`lib/domain-lists.js`) and the check of subscribers' domains (`lib/list-hygiene.js`).
- **Email providers**: `lib/email-provider` switches between `ses.js` and `postshiba.js` (tenants, domains, sends), and their events become one shape (`lib/email-event-rules.js`). MailCheap's own emails (sign-in codes, alerts) go through `lib/platform-email.js`: Resend, or the provider.
- **Alerts**: `sendAlert` (`lib/alerts.js`) emails an account's owner, or `ADMIN_EMAILS` for the admins'. `lib/alert-rules.js` sorts the admins' alerts: those that need someone go to Telegram too (`lib/telegram.js`) when it's set up, and those an admin can't act on, because MailCheap handles it on its own or whoever needs to know already does, only show on the admin page, never emailed. A new admin alert gets its kind there, or `tests/alerts.test.mjs` fails.
- **Notifications**: the bell in the dashboard's sidebar (`components/ButtonNotifications.jsx`, the phone's top bar too) lists an account's notifications (`lib/notifications.js`): each alert emailed to its owner, and what only the dashboard tells, like a finished background import, a campaign sent or an issue the content check holds. Opening it marks what it shows read; each links to the page it's about. A new account alert gets its tone in `lib/notification-rules.js`, or `tests/notifications.test.mjs` fails.
- **Storage**: models in `models/`, images in S3 behind CloudFront or in Vercel Blob (`lib/image-storage.js`), rate limits in Upstash Redis or memory (`lib/rate-limit.js`).

## MailCheap Cloud and self-hosting

`isCloud()` in `lib/config.js` is `MAILCHEAP_CLOUD === "true"`, what mailcheap.ai runs with: open sign-up, plans and Stripe billing. Anything else is a self-hosted server: only the allowlist (`ADMIN_EMAILS`, `ALLOWED_EMAILS`) signs in, there's no billing and no limits. Both run from the same files, so a change has to work in both modes.

MailCheap Cloud's marketing site, analytics and support chat aren't part of the open source. Shared code reaches them only through the site extensions, `lib/site-extensions.js` and `components/SiteExtensions.jsx`, whose defaults add nothing: never import cloud-only code anywhere else.

## Rules

- The code is public: never commit secrets, keys, tokens or personal data (emails, phone numbers, addresses, customers' data), in code, tests, fixtures or commit messages. Tests use `example.com` and made-up values.
- Write "MailCheap" in display text: copy, titles, emails, docs, comments. Lowercase in identifiers and machine names: `mailcheap.ai`, `MAILCHEAP_CLOUD`, `LogoMailcheap`, package and file names.
- Copy is plain and short, in sentence case: only the first word of a title or a button is capitalized.
- A website the dashboard or a page shows, like a link in a report, a domain or a social profile, has its favicon next to it: `ImageFavicon` (`lib/favicon.js`), or a globe when there's no website to ask.
- A person the dashboard shows by their email address, like a contact or the signed-in member, has their picture next to it, never a plain initial: `AvatarContact`, which shows their Gravatar photo or their email domain's logo, with their initial only as the fallback. Its hash comes from `gravatarHash` (`lib/gravatar.js`), on the server. A photo they uploaded comes first (`AvatarUser`), and a newsletter sending an email shows its own picture (`AvatarNewsletter`).
- The help center (`app/(site)/help`, its articles listed in `lib/help.js`) explains every feature to the people who use MailCheap, in plain words. A change to what they see or to how something works updates the article that covers it in the same commit, and a new feature gets a section or an article. Articles take their numbers from the code's constants, so those follow it. Articles and the docs link to the dashboard pages they mention with `LinkApp` and the page's path, like `/domains`, which `tests/help.test.mjs` checks against the app's pages. Other text written for them that names a dashboard page, like MailCheap Cloud's changelog, links it the same way. Dashboard text that needs more than a line links to its article with `LinkHelp`. A section about something people see, like a block they insert in the editor or a dashboard page, shows it with `FigureHelp`: a 1600×1000 WebP screenshot in `public/help/<article>`, with made-up data only, retaken when what it shows changes.
- Public content pages end on a call to action. Shared ones, the help center and the docs, render the `ArticleUpsell` site extension at the end, which adds nothing on a self-hosted server.

## Security review

Every feature or significant change gets a security review of its diff before it's pushed: in Cursor, the security-review subagent, with a large diff split into parts it can read whole. Fix what it rates medium or higher first, each fix with its test. Check at least:

- **Authorization**: every action, route and MCP tool finds the account (`requireAccount()`, `authenticateRequest()`) and queries through `scoped()`, so no ID it's given reaches another account's data.
- **Injection**: input never becomes a Mongo operator or field path, unescaped HTML in a page, an email or a preview, CSS in a theme, a template in a merge tag, or a formula in a CSV export.
- **Abuse**: public endpoints have limits per visitor and per target, nothing a script can trigger mails a stranger more than a few times, and what a script can forge (Origin, Referer, a form token it can fetch) is never the only check.
- **Redirects**: return paths are same-origin only, and links built from input are http(s) only.
- **Consent and suppression**: unsubscribed, bounced and complained contacts stay out of sends, and bringing someone back takes their consent.
- **AI assistants**: MCP output that carries people's content (names, fields, issues) is data, never instructions, and a tool that deletes or sends says what it will do.
- **Secrets and personal data**: none in logs, error messages, the client bundle or the open source.

## Code style

- JavaScript, no TypeScript. Tabs. Don't run Prettier: it reformats whole files.
- Components in `components/`, in PascalCase and named by their kind first (`ButtonCopy.jsx`, `CardUsage.jsx`); other files in kebab-case. Server components by default, `"use client"` only where the browser is needed.
- Comments only for what the code can't show: a constraint, a reason, an outside rule. Not what the next line does.
- Read the code around a change and write like it.

## Tests

```bash
npm test       # node --test, the integration tests start their own mongod: it has to be on the PATH (or MONGOD_PATH)
npm run lint
npm run build
```

Tests import server actions and route handlers as they are; `tests/setup` stubs Next.js request APIs and every outside service, so nothing reaches the network. A change to behavior comes with its test, and the full suite and lint pass before it's pushed.
