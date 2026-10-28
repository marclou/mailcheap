import "server-only";
import mongoose from "mongoose";
import { AUTH_MODELS } from "@/lib/accounts";
import { findDismissals, getDismissal, isDismissed } from "@/lib/admin-dismissals";
import { getAdminEmails } from "@/lib/config";
import { REVIEW_PAUSE_CODE } from "@/lib/content-review-codes";
import { connectDb } from "@/lib/db";
import { PAID_SUBSCRIPTION_STATUSES, PLAN_IDS } from "@/lib/plans";
import Account from "@/models/Account";
import Alert from "@/models/Alert";
import Campaign from "@/models/Campaign";
import Message from "@/models/Message";
import Newsletter from "@/models/Newsletter";
import Segment from "@/models/Segment";

const DAY_MS = 86_400_000;
const STATS_DAYS = 30;
// "Needs a look" reads this many of each before setting aside the dismissed ones.
const ATTENTION_CANDIDATES = 100;
const DISMISSED_SHOWN = 20;
const PROVIDER_NAME = /(\b[Tt]he )?\b(?:Amazon SES|PostShiba|Groundmail|SES)\b/g;
const isSet = (field) => ({ $gt: [`$${field}`, null] });

// Alert titles and pause reasons can quote the email provider by name, which the admin page never shows.
export function hideProviderName(text) {
	return text ? text.replace(PROVIDER_NAME, (_match, _article, offset) => (offset === 0 ? "Email provider" : "the email provider")) : null;
}

function countWhen(condition) {
	return { $sum: { $cond: [condition, 1, 0] } };
}

function toDayKey(date) {
	return new Date(date).toISOString().slice(0, 10);
}

function unique(ids) {
	return [...new Set(ids.filter(Boolean).map(String))].map((id) => new mongoose.Types.ObjectId(id));
}

// The accounts the admins (ADMIN_EMAILS) own and test with: their emails aren't customers'.
async function findAdminAccountIds() {
	const admins = await mongoose.connection.db
		.collection(AUTH_MODELS.user)
		.find({ email: { $in: getAdminEmails() } }, { projection: { _id: 1 } })
		.toArray();
	return Account.distinct("_id", { ownerId: { $in: admins.map(({ _id }) => _id) } });
}

// Each account's owner email, by account id.
export async function findOwnerEmails(accountIds) {
	const accounts = await Account.find({ _id: { $in: unique(accountIds) } })
		.select({ ownerId: 1 })
		.lean();
	const users = await mongoose.connection.db
		.collection(AUTH_MODELS.user)
		.find({ _id: { $in: accounts.map(({ ownerId }) => ownerId) } }, { projection: { email: 1 } })
		.toArray();
	const emails = new Map(users.map(({ _id, email }) => [String(_id), email]));
	return new Map(accounts.map(({ _id, ownerId }) => [String(_id), emails.get(String(ownerId)) ?? null]));
}

// Across the whole database. paying: Stripe bills them; onFreePlan: an admin's free plan is in charge instead.
export async function getAccountTotals({ now = new Date() } = {}) {
	await connectDb();
	const [accounts, newThisWeek, paying, pastDue, onFreePlan, blocked] = await Promise.all([
		Account.countDocuments(),
		Account.countDocuments({ createdAt: { $gte: new Date(now.getTime() - 7 * DAY_MS) } }),
		Account.countDocuments({ subscriptionStatus: { $in: PAID_SUBSCRIPTION_STATUSES } }),
		Account.countDocuments({ subscriptionStatus: "past_due" }),
		Account.countDocuments({
			subscriptionStatus: { $nin: PAID_SUBSCRIPTION_STATUSES },
			"comp.plan": { $in: PLAN_IDS },
			"comp.grantedAt": { $ne: null },
			$or: [{ "comp.until": null }, { "comp.until": { $gt: now } }],
		}),
		Account.countDocuments({ status: "paused" }),
	]);
	return { accounts, newThisWeek, paying, pastDue, onFreePlan, blocked };
}

// Customers' emails over the last 30 UTC days, today's so far included, and ever: test emails and the admins' accounts
// stay out. Rates are out of emails sent, as the sending limits count them.
export async function getEmailStats({ now = new Date() } = {}) {
	await connectDb();
	const counted = { accountId: { $nin: await findAdminAccountIds() }, kind: { $ne: "test" } };
	const first = toDayKey(now.getTime() - (STATS_DAYS - 1) * DAY_MS);
	const [rows, total] = await Promise.all([
		Message.aggregate([
			{ $match: { ...counted, sentAt: { $gte: new Date(`${first}T00:00:00.000Z`) } } },
			{
				$group: {
					_id: { $dateToString: { format: "%Y-%m-%d", date: "$sentAt" } },
					sent: { $sum: 1 },
					hardBounces: countWhen(isSet("bouncedAt")),
					complaints: countWhen(isSet("complainedAt")),
				},
			},
		]).option({ crossAccount: true }),
		Message.countDocuments({ ...counted, sentAt: { $ne: null } }).setOptions({ crossAccount: true }),
	]);
	const byDay = new Map(rows.map(({ _id, ...counts }) => [_id, counts]));
	const days = Array.from({ length: STATS_DAYS }, (_, index) => {
		const day = toDayKey(new Date(`${first}T00:00:00.000Z`).getTime() + index * DAY_MS);
		return { day, sent: byDay.get(day)?.sent ?? 0 };
	});
	const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
	const sent = sum("sent");
	return {
		days,
		sent,
		total,
		bounceRate: sent > 0 ? sum("hardBounces") / sent : null,
		complaintRate: sent > 0 ? sum("complaints") / sent : null,
	};
}

// The newest customer campaigns that went out, are going out or are scheduled: upcoming ones first, then by when they
// started.
export async function listRecentCampaigns({ limit = 10 } = {}) {
	await connectDb();
	const campaigns = await Campaign.aggregate([
		{ $match: { accountId: { $nin: await findAdminAccountIds() }, status: { $in: ["scheduled", "sending", "sent"] } } },
		{ $set: { at: { $ifNull: ["$startedAt", "$scheduledAt"] } } },
		{ $sort: { at: -1, _id: -1 } },
		{ $limit: limit },
		{ $project: { subject: 1, status: 1, accountId: 1, at: 1, stats: 1 } },
	]).option({ crossAccount: true });
	const owners = await findOwnerEmails(campaigns.map(({ accountId }) => accountId));
	return campaigns.map(({ _id, accountId, subject, status, at, stats }) => ({
		id: String(_id),
		accountId: String(accountId),
		ownerEmail: owners.get(String(accountId)) ?? null,
		subject,
		status,
		at,
		recipients: stats?.recipients ?? 0,
		delivered: stats?.delivered ?? 0,
		bounced: stats?.bounced ?? 0,
		complained: stats?.complained ?? 0,
	}));
}

// Any account's campaign, for its admin page: the campaign, its account and newsletter, the segment it goes to and the
// account's alerts of the last 7 days. Only what describes them: never a contact.
export async function getCampaignForAdmin(id, { now = new Date() } = {}) {
	await connectDb();
	const campaign = await Campaign.findById(id).select("+review +draftReview").setOptions({ crossAccount: true }).lean();
	if (!campaign) return null;
	const { accountId } = campaign;
	const [account, newsletter, segment, alerts, owners] = await Promise.all([
		Account.findById(accountId).lean(),
		Newsletter.findOne({ _id: campaign.newsletterId, accountId }).lean(),
		campaign.segmentId ? Segment.findOne({ _id: campaign.segmentId, accountId }).select({ name: 1 }).lean() : null,
		Alert.find({ accountId, lastSentAt: { $gte: new Date(now.getTime() - 7 * DAY_MS) } })
			.sort({ lastSentAt: -1 })
			.limit(5)
			.select({ title: 1, key: 1, lastSentAt: 1 })
			.lean(),
		findOwnerEmails([accountId]),
	]);
	if (!account || !newsletter) return null;
	return {
		campaign: { ...campaign, pauseReason: hideProviderName(campaign.pauseReason) },
		account: { ...account, pauseReason: hideProviderName(account.pauseReason) },
		ownerEmail: owners.get(String(accountId)) ?? null,
		newsletter,
		segmentName: segment?.name ?? null,
		alerts: alerts.map(({ _id, title, key, lastSentAt }) => ({ id: String(_id), title: hideProviderName(title ?? key), at: lastSentAt })),
	};
}

// Any account's newsletter, for its admin page: the newsletter with the content checks of its own welcome and
// confirmation emails, its account, and the alerts of the last 7 days about either. Never a contact.
export async function getNewsletterForAdmin(id, { now = new Date() } = {}) {
	await connectDb();
	const newsletter = await Newsletter.findById(id).select("+reviews").setOptions({ crossAccount: true }).lean();
	if (!newsletter) return null;
	const { accountId } = newsletter;
	const since = new Date(now.getTime() - 7 * DAY_MS);
	// An alert only for the admin page is never emailed, so it has no lastSentAt.
	const [account, alerts, owners] = await Promise.all([
		Account.findById(accountId).lean(),
		Alert.find({
			$and: [
				{ $or: [{ accountId }, { key: { $regex: String(newsletter._id) } }] },
				{ $or: [{ lastSeenAt: { $gte: since } }, { lastSentAt: { $gte: since } }] },
			],
		})
			.sort({ lastSeenAt: -1, lastSentAt: -1 })
			.limit(5)
			.select({ title: 1, key: 1, lastSeenAt: 1, lastSentAt: 1 })
			.lean(),
		findOwnerEmails([accountId]),
	]);
	if (!account) return null;
	return {
		newsletter,
		account: { ...account, pauseReason: hideProviderName(account.pauseReason) },
		ownerEmail: owners.get(String(accountId)) ?? null,
		alerts: alerts.map(({ _id, title, key, lastSeenAt, lastSentAt }) => ({ id: String(_id), title: hideProviderName(title ?? key), at: lastSeenAt ?? lastSentAt })),
	};
}

// What may need an admin: customers' paused campaigns, blocked accounts, and the alerts of the last 7 days, each
// newest first. An item an admin dismissed (lib/admin-dismissals.js) moves to dismissed until it happens again.
export async function listAttention({ now = new Date(), limit = 10 } = {}) {
	await connectDb();
	const since = new Date(now.getTime() - 7 * DAY_MS);
	const [paused, blocked, alerts] = await Promise.all([
		Campaign.find({ accountId: { $nin: await findAdminAccountIds() }, status: "paused" })
			.sort({ updatedAt: -1 })
			.limit(ATTENTION_CANDIDATES)
			.select({ accountId: 1, subject: 1, pauseReason: 1, pauseCode: 1, updatedAt: 1 })
			.setOptions({ crossAccount: true })
			.lean(),
		Account.find({ status: "paused" }).sort({ pausedAt: -1 }).limit(ATTENTION_CANDIDATES).select({ pausedBy: 1, pauseReason: 1, pausedAt: 1 }).lean(),
		Alert.aggregate([
			{ $match: { $or: [{ lastSeenAt: { $gte: since } }, { lastSentAt: { $gte: since } }] } },
			{ $set: { at: { $max: ["$lastSeenAt", "$lastSentAt"] } } },
			{ $sort: { at: -1, _id: -1 } },
			{ $limit: ATTENTION_CANDIDATES },
			{
				$project: {
					accountId: 1,
					title: 1,
					key: 1,
					at: 1,
					recent: { $size: { $filter: { input: { $ifNull: ["$occurrences", []] }, cond: { $gte: ["$$this.at", since] } } } },
				},
			},
		]),
	]);
	const owners = await findOwnerEmails([...paused, ...alerts].map(({ accountId }) => accountId).concat(blocked.map(({ _id }) => _id)));
	const ownerOf = (accountId) => (accountId ? (owners.get(String(accountId)) ?? null) : null);
	const items = {
		pausedCampaigns: paused.map(({ _id, accountId, subject, pauseReason, pauseCode, updatedAt }) => ({
			kind: "campaign",
			id: String(_id),
			ownerEmail: ownerOf(accountId),
			subject,
			reason: pauseCode === REVIEW_PAUSE_CODE ? "Waiting for your review" : hideProviderName(pauseReason),
			at: updatedAt,
		})),
		blockedAccounts: blocked.map(({ _id, pausedBy, pauseReason, pausedAt }) => ({
			kind: "account",
			id: String(_id),
			ownerEmail: ownerOf(_id),
			by: pausedBy ?? null,
			reason: hideProviderName(pauseReason),
			at: pausedAt ?? null,
		})),
		alerts: alerts.map(({ _id, accountId, title, key, at, recent }) => ({
			kind: "alert",
			id: String(_id),
			ownerEmail: ownerOf(accountId),
			title: hideProviderName(title ?? key),
			at,
			// Over the last 7 days, from the occurrences kept (lib/alerts.js keeps 20).
			timesThisWeek: recent,
		})),
	};
	const dismissals = await findDismissals(Object.values(items).flat());
	const dismissed = [];
	const keep = (list) =>
		list
			.filter((item) => {
				const dismissal = getDismissal(dismissals, item.kind, item.id);
				if (!isDismissed(dismissal, item.at)) return true;
				dismissed.push({ ...item, dismissedAt: dismissal.dismissedAt, dismissedBy: dismissal.dismissedBy ?? null });
				return false;
			})
			.slice(0, limit);
	return {
		pausedCampaigns: keep(items.pausedCampaigns),
		blockedAccounts: keep(items.blockedAccounts),
		alerts: keep(items.alerts),
		dismissed: dismissed.sort((a, b) => new Date(b.dismissedAt) - new Date(a.dismissedAt)).slice(0, DISMISSED_SHOWN),
	};
}
