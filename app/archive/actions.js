"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { sendAlert } from "@/lib/alerts";
import { isBotRequest } from "@/lib/bot-check";
import { isSendingEnabled } from "@/lib/config";
import { getSignupProblem, upsertContact } from "@/lib/contacts";
import { readCountry } from "@/lib/countries";
import { connectDb } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { resolveArchiveHost } from "@/lib/host-routing";
import { getInbox } from "@/lib/inbox-links";
import { findSignupNewsletterWithScale } from "@/lib/public-newsletters";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { queueConfirmationEmail, queueWelcomeEmail } from "@/lib/sending";
import { normalizeEmail } from "@/lib/validation";

const PER_IP = { name: "subscribe-ip", limit: 5, window: "10 m" };
// Only alerts: refusing signups past a shared limit would let one flooder block every real signup.
// A flood from many IPs (list bombing) still needs a look: it fills the list with spam traps. Starter's: bigger plans
// multiply it (lib/plans.js getSignupScale), so a bigger list's viral moment isn't a flood.
const PER_NEWSLETTER = { name: "subscribe-newsletter", limit: 300, window: "10 m" };
const NOT_TAKING_SIGNUPS = "This newsletter is not taking signups";

export async function subscribe(_state, formData) {
	// People never see this field; bots fill in every input they find.
	if (formData.get("website")) return { ok: true };

	const email = normalizeEmail(formData.get("email"));
	if (!email) return { error: "Enter a valid email" };

	// Before the rate limit, so a script doesn't use up the signups of the network it shares with readers.
	if (await isBotRequest("signup")) return { error: "Couldn't sign you up. Try again in a minute." };
	const requestHeaders = await headers();
	if (await isRateLimited({ ...PER_IP, key: getClientIp(requestHeaders) })) {
		return { error: "Too many signups from your network. Try again in a few minutes." };
	}
	const emailProblem = await getSignupProblem(email);
	if (emailProblem) return { error: emailProblem };

	const slug = String(formData.get("newsletter") ?? "");
	// A newsletter's website takes its own signups only, so a script on one can't sign people up to another.
	const site = await resolveArchiveHost(requestHeaders.get("host"));
	if (site.isArchiveHost && site.slug !== slug) return { error: NOT_TAKING_SIGNUPS };

	await connectDb();
	const found = await findSignupNewsletterWithScale({ slug, archiveEnabled: true });
	if (!found) return { error: NOT_TAKING_SIGNUPS };
	const { newsletter, signupScale } = found;

	const perNewsletter = { ...PER_NEWSLETTER, limit: PER_NEWSLETTER.limit * signupScale };
	if (await isRateLimited({ ...perNewsletter, key: newsletter.slug })) {
		after(() =>
			sendAlert({
				accountId: newsletter.accountId,
				key: `signup-flood:${newsletter.slug}`,
				title: "Website signup flood",
				detail: `Over ${formatNumber(perNewsletter.limit)} signups to ${newsletter.name} in 10 minutes. They still go through (${PER_IP.limit} per visitor per 10 minutes); check new contacts for junk.`,
				path: "/contacts",
			})
		);
	}

	const { contact, created } = await upsertContact({
		newsletter,
		email,
		source: "website",
		resubscribe: true,
		country: readCountry(requestHeaders),
	});
	const isPending = contact.status === "pending";
	if (isSendingEnabled() && (isPending || (created && contact.status === "active"))) {
		const queue = isPending ? queueConfirmationEmail : queueWelcomeEmail;
		after(() =>
			queue({ newsletter, contact }).catch((error) =>
				console.error(`[subscribe] Signup email for ${contact._id} failed:`, error.message)
			)
		);
	}
	if (!isPending) return { ok: true };
	return { ok: true, pending: true, email, inbox: getInbox({ email, fromEmail: newsletter.fromEmail }) };
}
