import { NextResponse, after } from "next/server";
import { sendAlert } from "@/lib/alerts";
import { authenticateRequest } from "@/lib/api-keys";
import { isSendingEnabled } from "@/lib/config";
import { upsertContact } from "@/lib/contacts";
import { getInbox } from "@/lib/inbox-links";
import { isRateLimited } from "@/lib/rate-limit";
import { findNewsletterBySlug } from "@/lib/records";
import { queueConfirmationEmail, queueWelcomeEmail } from "@/lib/sending";
import { isPlainObject, normalizeEmail } from "@/lib/validation";

const MAX_SOURCE_LENGTH = 100;
// Each signup can send a welcome email, so a leaked key or a form without its own limit must not be
// able to flood the list. Sites that pass their visitor's IP get the archive form's per-visitor limit.
const PER_KEY = { name: "api-contacts-key", limit: 600, window: "1 h" };
const PER_VISITOR = { name: "api-contacts-ip", limit: 5, window: "10 m" };
const IP_PATTERN = /^[0-9a-f.:]{3,45}$/i;

function fail(status, error) {
	return NextResponse.json({ error }, { status });
}

function readInput(body) {
	if (!isPlainObject(body)) return { error: "Send a JSON object" };
	const { newsletter, email, source, resubscribe, ip } = body;
	if (typeof newsletter !== "string" || !newsletter.trim()) return { error: "newsletter is required" };

	const normalizedEmail = normalizeEmail(email);
	if (!normalizedEmail) return { error: "email is invalid" };
	if (source !== undefined && (typeof source !== "string" || source.length > MAX_SOURCE_LENGTH)) {
		return { error: `source must be a string of at most ${MAX_SOURCE_LENGTH} characters` };
	}
	if (resubscribe !== undefined && typeof resubscribe !== "boolean") {
		return { error: "resubscribe must be a boolean" };
	}
	return {
		slug: newsletter.trim().toLowerCase(),
		email: normalizedEmail,
		source: source?.trim() || "api",
		resubscribe: resubscribe === true,
		ip: typeof ip === "string" && IP_PATTERN.test(ip) ? ip : null,
	};
}

export async function POST(request) {
	const apiKey = await authenticateRequest(request);
	if (!apiKey) return fail(401, "Invalid API key");

	const input = readInput(await request.json().catch(() => null));
	if (input.error) return fail(400, input.error);

	const keyId = String(apiKey._id);
	if (await isRateLimited({ ...PER_KEY, key: keyId })) {
		await sendAlert({
			key: `api-signup-flood:${keyId}`,
			title: "API signups paused",
			detail: `The "${apiKey.name}" key sent over ${PER_KEY.limit} signups in an hour. New ones are refused until it slows down. If that isn't your site, revoke the key.`,
			path: "/api-keys",
		});
		return fail(429, "Too many signups, try again later");
	}
	if (input.ip && (await isRateLimited({ ...PER_VISITOR, key: `${keyId}:${input.ip}` }))) {
		return fail(429, "Too many signups from this visitor, try again later");
	}

	const newsletter = await findNewsletterBySlug(input.slug);
	if (!newsletter) return fail(404, "Newsletter not found");

	const { contact, created } = await upsertContact({
		newsletter,
		email: input.email,
		source: input.source,
		resubscribe: input.resubscribe,
	});
	// A pending contact who signs up again gets the confirmation again (throttled per address).
	const isPending = contact.status === "pending";
	if (isSendingEnabled() && (isPending || (created && contact.status === "active"))) {
		const queue = isPending ? queueConfirmationEmail : queueWelcomeEmail;
		after(() =>
			queue({ newsletter, contact }).catch((error) =>
				console.error(`[api/contacts] Signup email for ${contact._id} failed:`, error.message)
			)
		);
	}

	return NextResponse.json(
		{
			id: String(contact._id),
			status: contact.status,
			created,
			// For the site's "check your inbox" message.
			...(isPending && { inbox: getInbox({ email: contact.email, fromEmail: newsletter.fromEmail }) }),
		},
		{ status: created ? 201 : 200 }
	);
}
