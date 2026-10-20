import "server-only";
import mongoose from "mongoose";
import { AUTH_MODELS } from "@/lib/accounts";
import { getAdminEmails } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { PAID_SUBSCRIPTION_STATUSES, PLAN_IDS } from "@/lib/plans";
import Account from "@/models/Account";
import Alert from "@/models/Alert";
import Campaign from "@/models/Campaign";
import Message from "@/models/Message";

const DAY_MS = 86_400_000;
const STATS_DAYS = 30;
const PROVIDER_NAME = /(\b[Tt]he )?\b(?:Amazon SES|PostShiba|SES)\b/g;
const isSet = (field) => ({ $gt: [`$${field}`, null] });

// Alert titles and pause reasons can quote the email provider by name, which the admin page never shows.
function hideProviderName(text) {
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
async function findOwnerEmails(accountIds) {
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

// What may need an admin: customers' paused campaigns, blocked accounts, and the alerts of the last 7 days.
export async function listAttention({ now = new Date(), limit = 10 } = {}) {
	await connectDb();
	const [paused, blocked, alerts] = await Promise.all([
		Campaign.find({ accountId: { $nin: await findAdminAccountIds() }, status: "paused" })
			.sort({ updatedAt: -1 })
			.limit(limit)
			.select({ accountId: 1, subject: 1, pauseReason: 1, updatedAt: 1 })
			.setOptions({ crossAccount: true })
			.lean(),
		Account.find({ status: "paused" }).sort({ pausedAt: -1 }).limit(limit).select({ pausedBy: 1, pauseReason: 1, pausedAt: 1 }).lean(),
		Alert.find({ lastSentAt: { $gte: new Date(now.getTime() - 7 * DAY_MS) } })
			.sort({ lastSentAt: -1 })
			.limit(limit)
			.select({ accountId: 1, title: 1, key: 1, lastSentAt: 1 })
			.lean(),
	]);
	const owners = await findOwnerEmails([...paused, ...alerts].map(({ accountId }) => accountId).concat(blocked.map(({ _id }) => _id)));
	const ownerOf = (accountId) => (accountId ? (owners.get(String(accountId)) ?? null) : null);
	return {
		pausedCampaigns: paused.map(({ _id, accountId, subject, pauseReason, updatedAt }) => ({
			id: String(_id),
			ownerEmail: ownerOf(accountId),
			subject,
			reason: hideProviderName(pauseReason),
			at: updatedAt,
		})),
		blockedAccounts: blocked.map(({ _id, pausedBy, pauseReason, pausedAt }) => ({
			id: String(_id),
			ownerEmail: ownerOf(_id),
			by: pausedBy ?? null,
			reason: hideProviderName(pauseReason),
			at: pausedAt ?? null,
		})),
		alerts: alerts.map(({ _id, accountId, title, key, lastSentAt }) => ({
			id: String(_id),
			ownerEmail: ownerOf(accountId),
			title: hideProviderName(title ?? key),
			at: lastSentAt,
		})),
	};
}
