import { BLOCKED_PLAN_DAYS } from "@/lib/account-state";
import { getAlertType } from "@/lib/alert-rules";
import { LIMITS } from "@/lib/config";
import { formatPercent } from "@/lib/format";

// What each kind of alert (lib/alert-rules.js getAlertType) means on the admin page: what happened, and what MailCheap
// did on its own. Alerts from before Oct 20, 2026 kept no details, so this is all an older one has. Never names the
// email provider.
export const ALERT_TYPES = {
	"account-blocked": {
		what: "MailCheap blocked an account on its own after spam signals.",
		done: `Every send from it stopped, its plan isn't billed until it's unblocked and ends if it's still blocked ${BLOCKED_PLAN_DAYS} days later, and its owner was told.`,
	},
	"account-blocked-by-admin": {
		what: "An admin blocked an account.",
		done: `Every send from it stopped, its plan isn't billed until it's unblocked and ends if it's still blocked ${BLOCKED_PLAN_DAYS} days later, and its owner was told.`,
	},
	"account-unblocked": {
		what: "An admin unblocked an account.",
		done: "It can send again, its plan is billed again, and its owner got an email.",
	},
	"account-signup-flood": {
		what: "An account's API keys, apps and dashboard added more contacts in an hour than its limit.",
		done: "New signups are refused until it slows down. The owner got an email.",
	},
	"affiliate-ads": {
		what: "Someone came through an affiliate's link from an ad, which the program doesn't allow.",
		done: "The click didn't count. Ads from a few networks ban the affiliate two days later, unless you keep them.",
	},
	"affiliate-event-failed": {
		what: "A Stripe payment, refund or dispute of a referred customer couldn't be recorded for their affiliate.",
		done: "Billing handled it as usual. The daily affiliates job tries it again.",
	},
	"affiliate-payouts": {
		what: "Affiliate payouts are ready to send.",
		done: "Nothing goes out on its own: send each one in Wise, then mark it paid on its page.",
	},
	"affiliate-review": {
		what: "An affiliate's referral looks like the affiliate's own, or its customer disputed a payment or got blocked.",
		done: "Its commissions wait for your approval or rejection. One paid with the affiliate's own card is rejected on its own.",
	},
	"api-signup-flood": {
		what: "One API key added more contacts in an hour than its limit.",
		done: "New signups from that key are refused until it slows down. The owner got an email.",
	},
	"billing-pause-failed": {
		what: "An account is blocked, but Stripe didn't pause its plan's billing.",
		done: "Stripe can still renew it. The hourly check tries again.",
	},
	"billing-resume-failed": {
		what: "An account was unblocked, but Stripe didn't bill its plan again.",
		done: "Its renewals are voided until the hourly check resumes it.",
	},
	"blocked-plan-end-failed": {
		what: `An account was blocked for ${BLOCKED_PLAN_DAYS} days, but Stripe didn't cancel its plan.`,
		done: "Its plan stays active without being billed. The hourly check tries again.",
	},
	"blocked-plan-ended": {
		what: `An account was still blocked ${BLOCKED_PLAN_DAYS} days after its plan's billing paused.`,
		done: "Its plan was canceled, without a refund, and its owner got an email. Its data is kept.",
	},
	"campaign-paused": { what: "A campaign paused itself.", done: "Sending stopped where it was, and the owner got the reason by email." },
	complaints: { what: "A subscriber marked an email as spam.", done: "The address is suppressed for that account, and the owner got an email." },
	"content-approved": {
		what: "An admin approved an issue the content check held, but its send couldn't start.",
		done: "It's a draft again, and its owner got the reason by email.",
	},
	"content-check-failed": {
		what: "The content check couldn't reach OpenAI.",
		done: "Issues and welcome and confirmation emails go out without the check until it works again.",
	},
	"content-check-limit": {
		what: "An account sent more new content in an hour than the content check's budget.",
		done: "Its new issues, and new versions of its welcome and confirmation emails, wait for you to approve or reject them. Content already checked still goes out.",
	},
	"content-draft-review": {
		what: "The content check found something clearly harmful in a draft, at its review step: phishing, malware, a scam or explicit content.",
		done: "Nothing is held yet, and its owner sees nothing. A send of it as it is waits for you, like any issue the check holds.",
	},
	"content-flagged": { what: "The content check wasn't sure about an issue.", done: "It went out as usual. Look at it on its campaign page when you can." },
	"content-rejected": { what: "An admin rejected an issue the content check held.", done: "It stays paused for good, and its owner got an email." },
	"content-review": {
		what: "The content check found something clearly harmful in an issue: phishing, malware, a scam or explicit content.",
		done: "Its send waits, paused, until you approve or reject it on the campaign's admin page. Its owner sees In review.",
	},
	"credential-refused": {
		what: "The email provider refused one account's own login, maybe only for a moment.",
		done: "Its campaign tries again 10 minutes later and pauses on a third refusal within the hour. A second account refused within the hour alerts you.",
	},
	"customer-blocked": {
		what: "The email provider refuses a customer's emails: it suspended or holds the domain they send from, or their sending space. Nothing on their dashboard lifts it.",
		done: "Their campaigns pause and their signup and test emails fail until it's lifted at the provider. The owner only sees the provider's refusal.",
	},
	"deleted-email-signup": { what: "Someone whose account was deleted signed up again with the same email.", done: "Nothing: it's a record for the admins." },
	"dns-helper-cap": { what: "The DNS helper that sets up shared addresses reached its cap.", done: "New shared addresses wait until it's back." },
	"dns-helper-down": { what: "The DNS helper that sets up shared addresses is down.", done: "New shared addresses wait until it's back." },
	"domain-dns": {
		what: "A verified sending domain's DNS records changed: one is gone, doesn't match or is behind a proxy like Cloudflare's.",
		done: "Nothing goes out from the domain until its owner fixes the record and checks it again, and a campaign sending from it pauses. The owner got an email.",
	},
	"embed-flood": { what: "A signup form on another site took more signups than its limit.", done: "The form refuses new signups until they slow down. The owner got an email." },
	"embed-flood-plain": {
		what: "A newsletter's HTML signup form took more signups than its limit.",
		done: "The form refuses new signups until they slow down. The owner got an email.",
	},
	"embed-plain-off": {
		what: "A signup came from a newsletter's HTML form while its form only takes signups from listed sites.",
		done: "The signup was refused. The owner hears about it once a day.",
	},
	"fraud-warning": {
		what: "A card's bank reported a payment as fraud: an early fraud warning, which usually turns into a chargeback.",
		done: "The payment was refunded before the chargeback, and the plan it paid for ended at once. Its owner was told.",
	},
	"gmail-backoff": {
		what: "Gmail is rate limiting a newsletter's domain: it holds its emails back and asks it to slow down.",
		done: "The sends from that domain paused for 6 hours, then go on by themselves, Gmail getting half its day's emails, twice as many each day. The owner got an email.",
	},
	"gmail-refusals": {
		what: `Gmail refused over ${formatPercent(LIMITS.pause.refusalRate)} of a campaign's emails as likely unsolicited, which usually means its contacts never asked for them.`,
		done: "The send paused and its owner got the reason by email. Gmail's refusals never block an account, so if they resume it, it goes on.",
	},
	"gmail-spam-rate": { what: "Gmail's spam rate for MailCheap's mail is high.", done: "Accounts Gmail flags pause or block on their own." },
	"gmail-warning": { what: "Gmail reports spam complaints for an account.", done: "Nothing is paused yet. The owner was warned." },
	"inbound-cap": { what: "MailCheap's own inboxes got too many emails in a day.", done: "Forwards paused. The emails stay in storage for 30 days." },
	"job-failing": { what: "A background job failed several times in a row.", done: "After its last try, the queue keeps it in its dead letter queue." },
	"payment-refunded": {
		what: "An account's card's bank reported one of its payments as fraud.",
		done: "The payment was refunded, the plan it paid for ended, and the owner got an email.",
	},
	"platform-email-failed": { what: "Sign-in codes stopped going out.", done: "Nobody can sign in with a code until it's fixed." },
	"postmaster-refused": { what: "Google Postmaster Tools refused MailCheap.", done: "Gmail's spam rates go unchecked until it's connected again." },
	"postshiba-cap": { what: "A sending cluster at the email provider reached its cap.", done: "Sends on it wait until there's room." },
	"postshiba-kyc": { what: "The email provider's verification of MailCheap changed.", done: "Nothing on MailCheap's side." },
	"postshiba-status-refused": { what: "The email provider refused MailCheap's status check.", done: "Sends need the same keys, so check them." },
	"postshiba-suspended": { what: "The email provider suspended MailCheap's team.", done: "Nothing goes out until it's lifted." },
	"purge-postponed": { what: "A deleted account's data couldn't be purged yet.", done: "The purge tries again tomorrow." },
	"qstash-refused": { what: "The job queue refused a job.", done: "Sends, schedules and purges wait until it's fixed." },
	"rate-limit-unavailable": { what: "The rate limiter's database failed.", done: "Limits are counted in each server's memory until it's back." },
	"rates-warning": { what: "An account's bounces or complaints are close to the level that pauses sends.", done: "Sends go on. The owner was warned." },
	"scheduled-send": { what: "A scheduled campaign couldn't start.", done: "It's a draft again, and the owner got an email." },
	"send-refused": { what: "The email provider refused MailCheap's sends.", done: "Sends stop until it's sorted out." },
	"shared-sender-failed": {
		what: "A newsletter's shared sending address couldn't be set up at the email provider.",
		done: "The newsletter's next save or send tries again.",
	},
	"shared-sender-left": { what: "An old sending subdomain is still set up at the email provider.", done: "Nothing: remove it there by hand." },
	"shared-sender-waiting": { what: "A newsletter's shared sending address waits for the DNS helper.", done: "The newsletter's next save or send tries again." },
	"signup-email-flagged": {
		what: "The content check wasn't sure about a newsletter's own welcome, confirmation or last-chance email.",
		done: "It goes out as usual. Look at it on the newsletter's admin page when you can.",
	},
	"signup-email-rejected": {
		what: "An admin rejected a newsletter's own welcome, confirmation or last-chance email the content check held.",
		done: "The built-in confirmation or last-chance email goes out instead, or no welcome email, until its owner changes it. Its owner got an email.",
	},
	"signup-email-review": {
		what: "The content check found something clearly harmful in a newsletter's own welcome, confirmation or last-chance email.",
		done: "The built-in confirmation or last-chance email goes out instead, or no welcome email, until you approve or reject it on the newsletter's admin page. Its owner sees In review.",
	},
	"signup-flood": { what: "A newsletter's website took a burst of signups.", done: "They still go through, within each visitor's limit. The owner got an email." },
	"stripe-webhook-failed": { what: "MailCheap couldn't handle a Stripe event.", done: "Stripe retries it for 3 days. Until then, a plan can be out of date." },
	tenant: { what: "The email provider changed an account's sending space.", done: "Nothing: it's a record for the admins." },
	"tenant-failed": { what: "An account's sending space at the email provider wasn't created.", done: "The account's first send tries again." },
	"tenant-hold": { what: "The email provider holds an account's sending space.", done: "Its sends are refused until the provider lifts the hold." },
	"tenant-resume-failed": { what: "A restored account's sending space wasn't resumed at the email provider.", done: "It can't send until it's resumed by hand." },
	"tenant-suspend-failed": {
		what: "An account is stopped in MailCheap, but its sending space at the email provider wasn't suspended.",
		done: "Not retried: suspend it at the provider by hand.",
	},
	"web-page-flagged": {
		what: "The content check wasn't sure about a change to an issue's page, after the issue went out.",
		done: "It went live as usual. Look at the page when you can.",
	},
	"web-page-review": {
		what: "The content check found something clearly harmful in a change to an issue's page, after the issue went out: phishing, malware, a scam or explicit content.",
		done: "The change didn't go live: the page keeps what it showed, and its owner was told the change can't go on the website.",
	},
	"webhook-failing": { what: "A webhook failed 3 times within an hour.", done: "Its sender retries for a while, then drops the events." },
	"welcome-cap": {
		what: "A newsletter sent more welcome and confirmation emails in 10 minutes than its cap.",
		done: "New signups get no email until it slows down. The owner got an email.",
	},
	"welcome-paused": { what: "An account used its plan's emails for the month, so welcome emails paused.", done: "Confirmation emails still go out. The owner got an email." },
};

export function describeAlertType(key) {
	return ALERT_TYPES[getAlertType(key)] ?? null;
}
