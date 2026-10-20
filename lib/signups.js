import "server-only";
import { after } from "next/server";
import { isSendingEnabled } from "@/lib/config";
import { upsertContact } from "@/lib/contacts";
import { getInbox } from "@/lib/inbox-links";
import { queueConfirmationEmail, queueWelcomeEmail } from "@/lib/sending";
import Contact from "@/models/Contact";

const RETURNING_STATUSES = ["unsubscribed", "dormant"];

// A signup from a form: the contact, then its confirmation or welcome email once the response is out. confirmReturning:
// someone who unsubscribed or went dormant confirms by email before they're back, even where new signups join at once,
// for forms on other sites, which a script can fill in with a stranger's address. sourceDomain: the site the form was on.
// firstName: cleaned already; a contact who had one keeps theirs.
export async function addSignup({ newsletter, email, source, sourceDomain = null, firstName = "", confirmReturning = false }) {
	const { accountId } = newsletter;
	const isReturning =
		confirmReturning &&
		!newsletter.requireConfirmation &&
		Boolean(await Contact.exists({ accountId, newsletterId: newsletter._id, email, status: { $in: RETURNING_STATUSES } }));
	const { contact, created } = await upsertContact({
		newsletter: isReturning ? { ...newsletter, requireConfirmation: true } : newsletter,
		email,
		source,
		resubscribe: true,
		profile: firstName ? { firstName } : {},
	});
	if (created && sourceDomain) await Contact.updateOne({ accountId, _id: contact._id }, { $set: { sourceDomain } });

	const isPending = contact.status === "pending";
	if (isSendingEnabled() && (isPending || (created && contact.status === "active"))) {
		const queue = isPending ? queueConfirmationEmail : queueWelcomeEmail;
		after(() =>
			queue({ newsletter, contact }).catch((error) =>
				console.error(`[signup] Signup email for ${contact._id} failed:`, error.message)
			)
		);
	}
	return { isPending, inbox: isPending ? getInbox({ email, fromEmail: newsletter.fromEmail }) : null };
}
