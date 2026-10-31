import "server-only";
import { scoped } from "@/lib/account-scope";
import { getSharedDomain } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { hasConnectedApp } from "@/lib/oauth";
import ApiKey from "@/models/ApiKey";
import Campaign from "@/models/Campaign";
import Contact from "@/models/Contact";
import Domain from "@/models/Domain";
import Newsletter from "@/models/Newsletter";

// A campaign that went out or will: unscheduling one takes it back to draft.
const SENT_STATUSES = ["scheduled", "sending", "paused", "sent"];

// The dashboard's get-started panel, for any account, paying or not: each newsletter has its own, until it's closed or
// finished, so a newsletter added later starts with it. Before that, closing or finishing it was the account's, which
// still hides it for the newsletters the account had then.
export function isGetStartedOpen(account, newsletter) {
	if (!newsletter || newsletter.getStarted?.dismissedAt || newsletter.getStarted?.finishedAt) return false;
	const { checklistDismissedAt, checklistFinishedAt } = account.onboarding ?? {};
	return ![checklistDismissedAt, checklistFinishedAt].some((closedAt) => closedAt && newsletter.createdAt < closedAt);
}

// One cheap query per step, all at once. Subscribers, writing and sending are the newsletter's own; a domain and an AI
// agent are the account's, so they count for each of its newsletters. With a shared domain, sending from one's own is
// optional. Subscribers come first: people bring their list before they write to it. Connecting an AI agent comes
// last: a first send doesn't need it. Once every other step is done the newsletter's list is finished for good: a key
// revoked later doesn't bring it back.
export async function getGetStartedSteps(account, newsletterId) {
	await connectDb();
	const [campaign, contact, apiKey, isAppConnected, domain, sent, draft] = await Promise.all([
		Campaign.exists(scoped(account, { newsletterId, status: { $ne: "canceled" } })),
		Contact.exists(scoped(account, { newsletterId })),
		ApiKey.exists(scoped(account, { level: "full", revokedAt: null })),
		hasConnectedApp(account),
		Domain.exists(scoped(account, { verified: true })),
		Campaign.exists(scoped(account, { newsletterId, status: { $in: SENT_STATUSES } })),
		Campaign.findOne(scoped(account, { newsletterId, status: "draft" })).sort({ updatedAt: -1 }).select({ _id: 1 }).lean(),
	]);
	const steps = [
		{ id: "subscribers", isDone: Boolean(contact) },
		{ id: "write", isDone: Boolean(campaign) },
		{ id: "domain", isDone: Boolean(domain), isOptional: Boolean(getSharedDomain()) },
		{ id: "send", isDone: Boolean(sent) },
		{ id: "agent", isDone: Boolean(apiKey) || isAppConnected },
	];
	const isFinished = steps.every(({ isDone, isOptional }) => isDone || isOptional);
	if (isFinished) {
		await Newsletter.updateOne(
			scoped(account, { _id: newsletterId, "getStarted.finishedAt": null }),
			{ $set: { "getStarted.finishedAt": new Date() } }
		);
	}
	return { steps, draftId: draft ? String(draft._id) : null, isFinished };
}
