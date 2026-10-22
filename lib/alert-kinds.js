import { getAlertType } from "@/lib/alert-rules";

// What each kind of alert (lib/alert-rules.js getAlertType) means on the admin page: what happened, and what MailCheap
// did on its own. Alerts from before Oct 20, 2026 kept no details, so this is all an older one has. Never names the
// email provider.
export const ALERT_TYPES = {
	"account-blocked": { what: "MailCheap blocked an account on its own after spam signals.", done: "Every send from it stopped, and its owner was told." },
	"account-blocked-by-admin": { what: "An admin blocked an account.", done: "Every send from it stopped, and its owner was told." },
	"account-signup-flood": {
		what: "An account's API keys, apps and dashboard added more contacts in an hour than its limit.",
		done: "New signups are refused until it slows down. The owner got an email.",
	},
	"agent-account-created": {
		what: "An AI agent opened this account for its owner's email through AgentOnboard.",
		done: "Nothing else changed. The owner got an email, and can delete the account if it wasn't them.",
	},
	"api-signup-flood": {
		what: "One API key added more contacts in an hour than its limit.",
		done: "New signups from that key are refused until it slows down. The owner got an email.",
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
	"content-flagged": { what: "The content check wasn't sure about an issue.", done: "It went out as usual. Look at it on its campaign page when you can." },
	"content-rejected": { what: "An admin rejected an issue the content check held.", done: "It stays paused for good, and its owner got an email." },
	"content-review": {
		what: "The content check found something clearly harmful in an issue: phishing, malware, a scam or explicit content.",
		done: "Its send waits, paused, until you approve or reject it on the campaign's admin page. Its owner sees In review.",
	},
	"deleted-email-signup": { what: "Someone whose account was deleted signed up again with the same email.", done: "Nothing: it's a record for the admins." },
	"dns-helper-cap": { what: "The DNS helper that sets up shared addresses reached its cap.", done: "New shared addresses wait until it's back." },
	"dns-helper-down": { what: "The DNS helper that sets up shared addresses is down.", done: "New shared addresses wait until it's back." },
	"embed-flood": { what: "A signup form on another site took more signups than its limit.", done: "The form refuses new signups until they slow down. The owner got an email." },
	"embed-flood-plain": {
		what: "A newsletter's HTML signup form took more signups than its limit.",
		done: "The form refuses new signups until they slow down. The owner got an email.",
	},
	"embed-plain-off": {
		what: "A signup came from a newsletter's HTML form while its form only takes signups from listed sites.",
		done: "The signup was refused. The owner hears about it once a day.",
	},
	"gmail-spam-rate": { what: "Gmail's spam rate for MailCheap's mail is high.", done: "Accounts Gmail flags pause or block on their own." },
	"gmail-warning": { what: "Gmail reports spam complaints for an account.", done: "Nothing is paused yet. The owner was warned." },
	"inbound-cap": { what: "MailCheap's own inboxes got too many emails in a day.", done: "Forwards paused. The emails stay in storage for 30 days." },
	"job-failing": { what: "A background job failed several times in a row.", done: "After its last try, the queue keeps it in its dead letter queue." },
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
		what: "The content check wasn't sure about a newsletter's own welcome or confirmation email.",
		done: "It goes out as usual. Look at it on the newsletter's admin page when you can.",
	},
	"signup-email-rejected": {
		what: "An admin rejected a newsletter's own welcome or confirmation email the content check held.",
		done: "New subscribers get the built-in confirmation email, or no welcome email, until its owner changes it. Its owner got an email.",
	},
	"signup-email-review": {
		what: "The content check found something clearly harmful in a newsletter's own welcome or confirmation email.",
		done: "New subscribers get the built-in confirmation email, or no welcome email, until you approve or reject it on the newsletter's admin page. Its owner sees In review.",
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
