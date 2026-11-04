import "server-only";
import { Types } from "mongoose";
import * as z from "zod";
import { scopedNewsletter } from "@/lib/account-scope";
import { findOwnerEmail } from "@/lib/accounts";
import { actionError } from "@/lib/actions/errors";
import { isSendingEnabled } from "@/lib/config";
import { MAX_TEST_RECIPIENTS, OUTSIDE_TEST_ADDRESSES_PER_DAY, TESTS_PER_OUTSIDE_ADDRESS_PER_DAY } from "@/lib/test-email-rules";
import { getUsage } from "@/lib/usage";
import { MAX_EMAIL_LENGTH, isObjectIdString } from "@/lib/validation";
import Newsletter from "@/models/Newsletter";

export const idInput = (thing) => z.string().trim().min(1).max(100).describe(`The ${thing}'s ID`);
const newsletterReference = z.string().trim().min(1).max(100).optional();
export const newsletterInput = newsletterReference.describe(
	"The newsletter's ID or slug. Default: the account's first newsletter, the one it has had longest."
);
export const newsletterFilterInput = newsletterReference.describe("Only this newsletter's: its ID or slug. Default: every newsletter.");

export const dateOutput = z.string().nullable();
export const DnsRecordSchema = z.object({
	type: z.string(),
	name: z.string().describe("The full name"),
	host: z.string().describe("The name as most DNS providers ask for it, without the zone: _dmarc.news for news.example.com, @ for the zone itself"),
	value: z.string(),
});
export const DnsStepsSchema = z.array(
	z.object({
		key: z.string(),
		title: z.string(),
		description: z.string(),
		status: z.string(),
		records: z.array(DnsRecordSchema),
	})
);

// Setup steps as lib/domain-records.js and lib/website-domain-rules.js make them, with each status in words.
export function toDnsSteps(steps) {
	return steps.map(({ key, title, description, status, records }) => ({
		key,
		title,
		description,
		status: status.label,
		records: records.map(({ type, name, host, value }) => ({ type, name, host, value })),
	}));
}
const NO_LIMIT = "null on a self-hosted server without billing: no limit";
export const UsageSchema = z.object({
	emailsSent: z.number().int().describe("Emails sent this month, every kind counted"),
	emailsLimit: z.number().int().nullable().describe(NO_LIMIT),
	emailsLeft: z.number().int().nullable().describe(NO_LIMIT),
	subscribers: z.number().int().describe("Active contacts"),
	subscribersLimit: z.number().int().nullable().describe(NO_LIMIT),
	periodStart: dateOutput,
	periodEnd: dateOutput.describe("When the email count starts over"),
	welcomeEmailsPaused: z
		.boolean()
		.describe(
			"This month's emails are used up: new subscribers get no welcome email until the count starts over or the plan grows, and don't get it later. Confirmation emails still go out."
		),
});

export function toIso(value) {
	return value ? new Date(value).toISOString() : null;
}

export function toId(value) {
	return value ? String(value) : null;
}

// The position of a page's last item, in lists sorted newest first with ties broken by ID.
export function encodeCursor(date, id) {
	return Buffer.from(JSON.stringify([date.toISOString(), String(id)])).toString("base64url");
}

// The items after a cursor's position, on the date field the list is sorted by.
export function afterCursor(cursor, field) {
	const { date, id } = decodeCursor(cursor);
	return { $or: [{ [field]: { $lt: date } }, { [field]: date, _id: { $lt: id } }] };
}

function decodeCursor(cursor) {
	try {
		const [at, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
		const date = new Date(at);
		if (Number.isFinite(date.getTime()) && isObjectIdString(id)) return { date, id: new Types.ObjectId(id) };
	} catch {
		// Falls through to the error below.
	}
	throw actionError("validation_failed", "cursor: use the nextCursor of the previous page");
}

export async function getUsageOutput(account) {
	const usage = await getUsage(account);
	return {
		...usage,
		emailsLeft: usage.emailsLimit === null ? null : Math.max(0, usage.emailsLimit - usage.emailsSent),
		periodStart: toIso(usage.periodStart),
		periodEnd: toIso(usage.periodEnd),
	};
}

// A team member's account only has their newsletter (lib/account-scope.js).
export function findFirstNewsletter(account, select) {
	const query = Newsletter.findOne(scopedNewsletter(account, {}, "_id")).sort({ createdAt: 1, _id: 1 });
	return (select ? query.select(select) : query).lean();
}

// By ID or slug. Without one, the account's first newsletter: a site's signup form or an agent set up while the
// account had one keeps reaching that one once there are more.
export async function findNewsletter(account, reference, select) {
	const value = reference?.trim().toLowerCase();
	if (!value) {
		const first = await findFirstNewsletter(account, select);
		if (!first) throw actionError("not_found", "Create a newsletter first");
		return first;
	}
	const filter = isObjectIdString(value) ? { $or: [{ _id: value }, { slug: value }] } : { slug: value };
	const query = Newsletter.findOne(scopedNewsletter(account, filter, "_id"));
	const found = await (select ? query.select(select) : query).lean();
	if (!found) throw actionError("not_found", "Newsletter not found");
	return found;
}

// The summary email's test goes to the signed-in user, or to the account's owner when an API key asks.
export async function findTestRecipient({ account, user }) {
	return user?.email ?? (await findOwnerEmail(account._id));
}

// What a test email takes on top of what it tests (lib/test-recipients.js). contact: whose, as a field of its own.
export const testInputs = {
	to: z
		.array(z.string().trim().max(MAX_EMAIL_LENGTH))
		.min(1)
		.max(MAX_TEST_RECIPIENTS)
		.optional()
		.describe(
			`The addresses it goes to, ${MAX_TEST_RECIPIENTS} at most, each its own email. Default: the ones saved with saveAsDefault, else the account owner's.`
		),
	saveAsDefault: z.boolean().optional().describe("True: once it's sent, these addresses are where the next tests go without to, the dashboard's included"),
};
export const testOutput = z.object({
	sentTo: z.string().describe("The addresses it went to, separated by commas"),
	messageId: z.string().describe("The first address's email"),
});
export const TEST_RECIPIENTS_RULES = `An address outside the account's team (its owner and the people who joined its newsletters' teams) can't be one that unsubscribed, bounced or complained, and gets ${TESTS_PER_OUTSIDE_ADDRESS_PER_DAY} tests a day at most; the account's tests reach ${OUTSIDE_TEST_ADDRESSES_PER_DAY} of them a day, or more on bigger plans. Confirm the addresses with the user before sending to anyone else.`;

export function assertSendingEnabled() {
	if (!isSendingEnabled()) throw actionError("sending_disabled", "Sending is off");
}

export function readPositiveInteger(value) {
	return Number.isInteger(value) && value > 0 ? value : undefined;
}
