import "server-only";
import { scoped } from "@/lib/account-scope";
import { publishPurge } from "@/lib/account-deletion";
import { isPaidStatus } from "@/lib/account-state";
import { findUser } from "@/lib/accounts";
import { sendAlert } from "@/lib/alerts";
import { revalidateArchive } from "@/lib/archive-data";
import { deleteUser } from "@/lib/auth";
import { isCloud } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { markPurged, recordDeletion } from "@/lib/deletion-records";
import { releaseDomains } from "@/lib/domains";
import { deleteImages, invalidateAccountImages } from "@/lib/image-storage";
import { disconnectAllApps } from "@/lib/oauth";
import { isTooEarly } from "@/lib/scheduling";
import { releaseSharedSenders } from "@/lib/shared-sender";
import { removeTenants } from "@/lib/tenants";
import { isObjectIdString } from "@/lib/validation";
import Account from "@/models/Account";
import Alert from "@/models/Alert";
import ApiKey from "@/models/ApiKey";
import Campaign from "@/models/Campaign";
import CampaignLink from "@/models/CampaignLink";
import Contact from "@/models/Contact";
import ContactImport from "@/models/ContactImport";
import DeletedContact from "@/models/DeletedContact";
import Event from "@/models/Event";
import Message from "@/models/Message";
import Newsletter from "@/models/Newsletter";
import Suppression from "@/models/Suppression";
import Upload from "@/models/Upload";

const RETRY_MS = 24 * 60 * 60 * 1000;
// Everything else the account holds, by its accountId. Newsletters, domains and uploads go after what they have at
// the email provider, in DNS and in storage.
const CONTENT_MODELS = [Message, Event, Contact, ContactImport, DeletedContact, Campaign, CampaignLink, Suppression, ApiKey, Alert];

// Runs when QStash delivers the job, at the end of the grace period. A job for an account restored since, or deleted
// again later, does nothing. A purge that can't finish tells the admins and tries again the next day.
export async function runPurge({ accountId, purgeAt }) {
	if (!isObjectIdString(String(accountId)) || typeof purgeAt !== "string") return { skipped: "invalid job" };
	await connectDb();
	const account = await Account.findById(accountId).lean();
	if (account?.deletion?.purgeAt?.toISOString() !== purgeAt) return { skipped: "not set to be purged at this time" };
	if (isTooEarly(account.deletion.purgeAt)) {
		await publishPurge({ accountId, purgeAt: account.deletion.purgeAt });
		return { waiting: true };
	}
	if (isCloud() && isPaidStatus(account.subscriptionStatus)) {
		return postpone(account, { reason: "its plan is active again", action: "Cancel it in Stripe before tomorrow's try." });
	}
	try {
		await purgeAccount(account);
	} catch (error) {
		return postpone(account, { reason: `the purge stopped: ${error.message}`, action: "Fix what stopped it before tomorrow's try." });
	}
	return { purged: true };
}

async function postpone(account, { reason, action }) {
	await sendAlert({
		accountId: null,
		key: `purge-postponed:${account._id}`,
		title: "Account purge postponed",
		detail: `Account ${account._id} was deleted by its owner, but ${reason}. The purge tries again tomorrow.`,
		action,
		path: "/admin",
	});
	await publishPurge({ accountId: account._id, purgeAt: account.deletion.purgeAt, at: new Date(Date.now() + RETRY_MS) });
	return { postponed: reason };
}

// Every step can run again, so a purge that stopped halfway picks up where it was. Once it starts, the account can't
// be restored, and signing in with its email opens a new one.
async function purgeAccount(account) {
	await Account.updateOne({ _id: account._id, "deletion.purgeStartedAt": null }, { $set: { "deletion.purgeStartedAt": new Date() } });
	await deleteOwner(account);
	for (const Model of CONTENT_MODELS) await Model.deleteMany(scoped(account));
	await releaseSharedSenders(account);
	await releaseDomains(account);
	await removeTenants(account);
	await deleteUploads(account);
	await Newsletter.deleteMany(scoped(account));
	await markPurged(account._id);
	await Account.deleteOne({ _id: account._id });
	revalidateArchive();
}

async function deleteOwner(account) {
	await disconnectAllApps(account);
	const user = await findUser(account.ownerId);
	if (!user) return;
	await recordDeletion({ account, email: user.email, requestedAt: account.deletion.requestedAt });
	await deleteUser({ id: user._id, email: user.email });
}

async function deleteUploads(account) {
	const uploads = await Upload.find(scoped(account)).select({ url: 1, pathname: 1 }).lean();
	await deleteImages(uploads);
	await invalidateAccountImages(account._id);
	await Upload.deleteMany(scoped(account));
}
