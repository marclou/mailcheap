// The status changes a newsletter's owner can make, from a contact's menu or update_contact_status. Bounced and
// complained never change: the address can't receive email, or its owner marked an email as spam. Unsubscribed only
// comes back as active, with the person's consent, so it can't slip back in through dormant.
export const STATUS_CHANGES = {
	active: ["dormant", "unsubscribed"],
	dormant: ["active", "unsubscribed"],
	pending: ["active", "unsubscribed"],
	unsubscribed: ["active"],
	bounced: [],
	complained: [],
};

export const SETTABLE_STATUSES = ["active", "dormant", "unsubscribed"];

// Bringing back someone who unsubscribed, or making active someone who never clicked the confirmation email, takes
// the owner's word that the person asked for it, as adding someone by hand does.
const CONSENT_CHANGES = { unsubscribed: "active", pending: "active" };

// Why a contact's status can't change, as its menu and the API say it.
export const STATUS_LOCKS = {
	bounced: "Their address bounced, so their status can't change",
	complained: "They marked an email as spam, so their status can't change",
};

// Bounced contacts the list hygiene stopped (lib/list-hygiene.js): its reason, as the contacts list and the contact
// show it, and why the status stays.
export const UNDELIVERABLE_LABELS = { "no-mail-server": "No mail server", "spam-domain": "Spam domain" };
const UNDELIVERABLE_LOCKS = {
	"no-mail-server": "Their domain can't receive email, so they stay stopped until it can",
	"spam-domain": "Their domain is a known spam domain, so their status can't change",
};

export function getStatusLock(status, undeliverableReason) {
	return (status === "bounced" && UNDELIVERABLE_LOCKS[undeliverableReason]) || STATUS_LOCKS[status] || null;
}

export function getStatusChanges(status) {
	return STATUS_CHANGES[status] ?? [];
}

export function needsConsent(from, to) {
	return CONSENT_CHANGES[from] === to;
}

// The statuses many contacts at once can be changed from (update_contacts_status, the contacts list's selection): every
// change above but those that take a person's consent, which is given one contact at a time.
export function getBulkFromStatuses(to) {
	return Object.keys(STATUS_CHANGES).filter((from) => STATUS_CHANGES[from].includes(to) && !needsConsent(from, to));
}

// What stops a change, or null. reason: the contact's undeliverableReason, if the list hygiene stopped it.
export function getStatusChangeProblem({ from, to, consent, reason }) {
	const lock = getStatusLock(from, reason);
	if (lock) return { code: "conflict", message: lock };
	if (!getStatusChanges(from).includes(to)) {
		const message = from === "unsubscribed" ? "Someone who unsubscribed can only be resubscribed" : `A ${from} contact can't become ${to}`;
		return { code: "conflict", message };
	}
	if (needsConsent(from, to) && consent !== true) {
		const message =
			from === "unsubscribed"
				? "consent must be true: only resubscribe someone who asked to get your emails again"
				: "consent must be true: only make a pending contact active if they asked to get your emails";
		return { code: "validation_failed", message };
	}
	return null;
}
