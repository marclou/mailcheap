import "server-only";
import { after } from "next/server";
import { getAppUrl, isSendingEnabled } from "@/lib/config";
import { upsertContact } from "@/lib/contacts";
import { connectDb } from "@/lib/db";
import { isRateLimited } from "@/lib/rate-limit";
import { queueConfirmationEmail, queueWelcomeEmail } from "@/lib/sending";
import { isWebhookToken, readReferral } from "@/lib/sparkloop-referrals";
import Newsletter from "@/models/Newsletter";
import SparkLoopAccount from "@/models/SparkLoopAccount";

export const WEBHOOK_PATH = "/api/webhooks/sparkloop/";
// Generous for real referrals; past it, SparkLoop gets a 429 and retries later.
const PER_NEWSLETTER = { name: "sparkloop-referrals", limit: 600, window: "10 m" };

export function getWebhookUrl(token) {
	return `${getAppUrl()}${WEBHOOK_PATH}${token}`;
}

// SparkLoop only delivers to https, so a local install can't get referrals.
export function canReceiveWebhooks() {
	return getAppUrl().startsWith("https://");
}

// No account, no webhook: after Disconnect the URL answers 404 even if SparkLoop still calls it.
export async function isConnectedWebhook(token) {
	await connectDb();
	const account = await SparkLoopAccount.findOne().select("webhookTokenHash").lean();
	return isWebhookToken(token, account?.webhookTokenHash);
}

export async function handleSparkLoopEvent(event) {
	const referral = readReferral(event);
	if (referral.skip) return referral;

	await connectDb();
	const newsletter = await Newsletter.findOne({ "sparkloop.publicationUuid": referral.publicationUuid }).lean();
	if (!newsletter) return { skip: "newsletter" };
	if (await isRateLimited({ ...PER_NEWSLETTER, key: newsletter.slug })) return { limited: true };

	// A referral never brings back someone who unsubscribed; confirmed opt-in still applies.
	const { contact, created } = await upsertContact({
		newsletter,
		email: referral.email,
		source: "sparkloop",
		resubscribe: false,
	});
	const isPending = contact.status === "pending";
	if (isSendingEnabled() && created && (isPending || contact.status === "active")) {
		const queue = isPending ? queueConfirmationEmail : queueWelcomeEmail;
		after(() =>
			queue({ newsletter, contact }).catch((error) =>
				console.error(`[sparkloop] Signup email for ${contact._id} failed:`, error.message)
			)
		);
	}
	return { contactId: String(contact._id), created };
}
