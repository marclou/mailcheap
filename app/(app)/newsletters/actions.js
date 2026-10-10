"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { revalidateArchive } from "@/lib/archive-data";
import { requireSession } from "@/lib/auth";
import { CLEANUP_LIMITS } from "@/lib/cleanup";
import { isSendingEnabled } from "@/lib/config";
import { getConfirmationProblem } from "@/lib/confirmation-content";
import { getDb, isUniqueViolation } from "@/lib/db";
import { MAX_AUTHOR_BIO_LENGTH, MAX_DESCRIPTION_LENGTH } from "@/lib/newsletters";
import { newsletters } from "@/lib/schema";
import { sendWelcomeTestEmail } from "@/lib/sending";
import { parseSocialLinks } from "@/lib/social";
import { isIdString } from "@/lib/validation";

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IMAGE_URL_PATTERN = /^(https:\/\/[^\s"'<>]{4,490}|\/[\w\-./]{1,200})$/;

function readText(formData, key) {
	return String(formData.get(key) ?? "").trim();
}

// Empty stays unset, so the newsletter's default applies.
function readNumber(formData, key) {
	const text = readText(formData, key);
	return text ? Number(text) : undefined;
}

function isWithin(value, min, max) {
	return value === undefined || (Number.isInteger(value) && value >= min && value <= max);
}

function readNewsletter(formData) {
	return {
		name: readText(formData, "name"),
		slug: readText(formData, "slug").toLowerCase(),
		imageUrl: readText(formData, "imageUrl"),
		fromName: readText(formData, "fromName"),
		fromEmail: readText(formData, "fromEmail").toLowerCase(),
		replyTo: readText(formData, "replyTo").toLowerCase(),
		postalAddress: readText(formData, "postalAddress"),
		archiveEnabled: formData.get("archiveEnabled") === "on",
		description: readText(formData, "description"),
		author: { bio: readText(formData, "authorBio"), imageUrl: readText(formData, "authorImageUrl") },
		socialLinks: parseSocialLinks(formData.get("socialLinks")),
		requireConfirmation: formData.get("requireConfirmation") === "on",
		cleanup: {
			enabled: formData.get("cleanupEnabled") === "on",
			issues: readNumber(formData, "cleanupIssues"),
			days: readNumber(formData, "cleanupDays"),
		},
		welcome: {
			enabled: formData.get("welcomeEnabled") === "on",
			subject: readText(formData, "welcomeSubject"),
			previewText: readText(formData, "welcomePreviewText"),
			markdown: String(formData.get("welcomeMarkdown") ?? ""),
		},
		confirmation: {
			subject: readText(formData, "confirmationSubject"),
			previewText: readText(formData, "confirmationPreviewText"),
			markdown: String(formData.get("confirmationMarkdown") ?? ""),
		},
	};
}

function validateNewsletter(values) {
	if (!values.name) return "Name is required";
	if (!SLUG_PATTERN.test(values.slug)) return "Slug can only use lowercase letters, numbers and dashes";
	if (values.imageUrl && !IMAGE_URL_PATTERN.test(values.imageUrl)) {
		return "Image must be an https:// link or a path like /logos/name.webp";
	}
	if (!EMAIL_PATTERN.test(values.fromEmail)) return "From email is invalid";
	if (values.replyTo && !EMAIL_PATTERN.test(values.replyTo)) return "Reply-to email is invalid";
	if (values.description.length > MAX_DESCRIPTION_LENGTH) {
		return `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters`;
	}
	if (values.author.bio.length > MAX_AUTHOR_BIO_LENGTH) {
		return `Keep the author bio under ${MAX_AUTHOR_BIO_LENGTH} characters`;
	}
	if (values.author.imageUrl && !IMAGE_URL_PATTERN.test(values.author.imageUrl)) {
		return "Author photo must be an https:// link or a path like /authors/name.jpg";
	}
	if (values.socialLinks.error) return values.socialLinks.error;
	const { minIssues, maxIssues, minDays, maxDays } = CLEANUP_LIMITS;
	if (!isWithin(values.cleanup.issues, minIssues, maxIssues)) {
		return `Ignored issues should be a whole number from ${minIssues} to ${maxIssues}`;
	}
	if (!isWithin(values.cleanup.days, minDays, maxDays)) {
		return `Quiet days should be a whole number from ${minDays} to ${maxDays}`;
	}
	if (values.welcome.enabled && (!values.welcome.subject || !values.welcome.markdown.trim())) {
		return "Welcome email needs a subject and content";
	}
	return values.requireConfirmation ? getConfirmationProblem(values.confirmation) : null;
}

// Sending errors become toasts; a thrown error would replace the page with the error boundary.
export async function sendWelcomeTest(newsletterId) {
	await requireSession();
	if (!isSendingEnabled()) return { error: "Sending is off" };
	try {
		await sendWelcomeTestEmail({ newsletterId, to: process.env.ADMIN_EMAIL });
		return { ok: true };
	} catch (error) {
		console.error("[newsletters] Welcome test failed:", error);
		return { error: error.message || "Sending failed" };
	}
}

export async function saveNewsletter(_state, formData) {
	await requireSession();
	const id = readText(formData, "id");
	if (id && !isIdString(id)) return { error: "Newsletter not found" };

	const values = readNewsletter(formData);
	const error = validateNewsletter(values);
	if (error) return { error };
	// A collapsed email section sends no fields, and what it had saved stays as it is.
	const { welcome, confirmation, ...rest } = values;
	const document = {
		...rest,
		socialLinks: values.socialLinks.links,
		...(formData.has("welcomeSubject") && { welcome }),
		...(formData.has("confirmationSubject") && { confirmation }),
	};

	let createdId;
	try {
		if (id) await getDb().update(newsletters).set(document).where(eq(newsletters._id, id));
		else [{ _id: createdId }] = await getDb().insert(newsletters).values(document).returning({ _id: newsletters._id });
	} catch (error) {
		if (isUniqueViolation(error)) return { error: "This slug is already used" };
		throw error;
	}

	revalidatePath("/newsletters");
	revalidateArchive();
	if (createdId) redirect(`/newsletters/${createdId}`);
	return { ok: true, savedAt: Date.now() };
}
