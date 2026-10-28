// Every provider's events come in one shape, made by its normalizer (lib/ses-event-mapping.js,
// lib/email-provider/postshiba-events.js, lib/email-provider/groundmail-events.js):
//   type: sent, delivered, bounce, complaint, unsubscribe, dropped, deferred, open or click
//   bounce: hard or soft, on bounces. undeliverable: on hard bounces, the provider's own class says the address or its
//   domain doesn't exist. feedback: the complaint's feedback type. link: the clicked URL.
//   accountId, messageId: MailCheap's ids, from the email's tags or unique args. providerMessageId, providerEventId.
//   email, emails: the recipient, and the addresses a bounce or complaint names. occurredAt.
//   reason: why it bounced or was deferred. detail: what the suppression records. error: why it was dropped.
//   suppressed: a drop because the provider suppresses the address. recordAs: the provider's own event name.
export const EMAIL_EVENT_TYPES = ["sent", "delivered", "bounce", "complaint", "unsubscribe", "dropped", "deferred", "open", "click"];

// Every send produces a delivery event; storing those raw would fill a small cluster within months.
const RECORDED_TYPES = new Set(["bounce", "complaint", "dropped", "deferred"]);

// Providers never un-deliver: later events only move a message to a worse status.
const BEFORE_DELIVERY = ["queued", "sent", "failed"];
const BEFORE_BOUNCE = [...BEFORE_DELIVERY, "delivered"];
const BEFORE_COMPLAINT = [...BEFORE_BOUNCE, "bounced"];

const OPEN = { field: "openedAt", stat: "opened", contactStat: "opens" };
const CLICK = { field: "clickedAt", stat: "clicked", contactStat: "clicks" };

// A receiving server that names a spam trap in a hard bounce: the address exists only to catch bought, scraped or
// old lists. Blocklists that count trap hits against a shared IP refuse with soft bounces, which don't count.
const SPAM_TRAP = /spam[\s_-]?trap|honey[\s_-]?pot/i;
// Gmail deferring a sender it rate limits: 4.7.28, "Gmail has detected an unusual rate of mail" from its domain or IP,
// with a link to its UnsolicitedRateLimitError page. Proton Mail defers with "an unusual rate of mail" too, as 4.7.0.
const GMAIL_RATE_LIMIT = /4\.7\.28|UnsolicitedRateLimitError|Gmail has detected an unusual rate/i;

function isUnsubscribeLink(link) {
	try {
		const url = new URL(link);
		return /^\/(api\/)?unsubscribe\/?$/.test(url.pathname) && url.searchParams.has("token");
	} catch {
		return false;
	}
}

// A click implies an open: the reader may have images blocked.
function engagementOf(type, occurredAt) {
	return type === "click"
		? { firsts: [OPEN, CLICK], engagement: { lastOpenAt: occurredAt, lastClickAt: occurredAt } }
		: { firsts: [OPEN], engagement: { lastOpenAt: occurredAt } };
}

// Opens and clicks from MailCheap's own pixel and links (lib/tracking.js): "Open" or "Click".
export function getTrackingPlan(type, occurredAt = new Date()) {
	return {
		type,
		occurredAt,
		status: null,
		error: null,
		suppression: null,
		unsubscribe: false,
		...engagementOf(type.toLowerCase(), occurredAt),
	};
}

// Pure: turns one normalized event into the updates lib/email-events.js applies, so the mapping is testable.
export function getEventPlan(event) {
	if (!event || !EMAIL_EVENT_TYPES.includes(event.type)) return null;
	const plan = {
		type: event.recordAs ?? event.type,
		providerMessageId: event.providerMessageId ?? null,
		providerEventId: event.providerEventId ?? null,
		messageId: event.messageId ?? null,
		accountId: event.accountId ?? null,
		email: event.email ?? null,
		occurredAt: event.occurredAt ?? new Date(),
		firsts: [],
		status: null,
		error: null,
		engagement: null,
		suppression: null,
		globalSuppression: null,
		unsubscribe: false,
		isSpamTrap: false,
		// Gmail's words when it rate limits the sender (lib/send-backoff.js).
		rateLimit: event.type === "deferred" && GMAIL_RATE_LIMIT.test(event.reason ?? "") ? event.reason.slice(0, 300) : null,
		isRecorded: RECORDED_TYPES.has(event.type),
		data: event.data,
	};
	const emails = event.emails?.length ? event.emails : [event.email].filter(Boolean);

	if (event.type === "delivered") {
		plan.firsts = [{ field: "deliveredAt", stat: "delivered" }];
		plan.status = { to: "delivered", from: BEFORE_DELIVERY };
	}

	if (event.type === "bounce") {
		const isHard = event.bounce === "hard";
		plan.error = `${isHard ? "Hard" : "Soft"} bounce: ${event.reason || "unknown"}`;
		if (isHard) {
			plan.firsts = [{ field: "bouncedAt", stat: "bounced" }];
			plan.status = { to: "bounced", from: BEFORE_BOUNCE };
			plan.suppression = {
				emails,
				reason: "bounce",
				detail: event.detail ?? "bounce",
				contactStatus: "bounced",
				contactStatusFrom: ["active", "dormant", "unsubscribed"],
			};
			plan.isSpamTrap = SPAM_TRAP.test(event.reason ?? "");
			if (plan.isSpamTrap || event.undeliverable) {
				plan.globalSuppression = { emails, reason: plan.isSpamTrap ? "trap" : "bounce", detail: plan.suppression.detail };
			}
		}
	}

	// "not-spam" is a recipient taking the email out of spam, not a complaint.
	if (event.type === "complaint" && event.feedback !== "not-spam") {
		plan.firsts = [{ field: "complainedAt", stat: "complained" }];
		plan.status = { to: "complained", from: BEFORE_COMPLAINT };
		plan.suppression = {
			emails,
			reason: "complaint",
			detail: event.detail ?? "abuse",
			contactStatus: "complained",
			contactStatusFrom: ["active", "dormant", "unsubscribed", "bounced"],
		};
	}

	// The provider's own one-click link; MailCheap's links unsubscribe through /api/unsubscribe.
	if (event.type === "unsubscribe") plan.unsubscribe = true;

	// Unsubscribe clicks aren't engagement.
	if (event.type === "open" || (event.type === "click" && !isUnsubscribeLink(event.link))) {
		Object.assign(plan, engagementOf(event.type, plan.occurredAt));
	}

	if (event.type === "dropped") {
		plan.status = { to: "failed", from: ["queued", "sent"], stat: "failed" };
		plan.error = event.error ?? "Dropped before sending";
		// Kept out of the account's sends; the contact's own status stays as it is.
		if (event.suppressed) plan.suppression = { emails, reason: "provider", detail: plan.error.slice(0, 200), contactStatus: null };
	}

	return plan;
}
