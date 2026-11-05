import "server-only";
import mongoose from "mongoose";
import { describeAlertType } from "@/lib/alert-kinds";
import { getAlertType, maskEmails } from "@/lib/alert-rules";
import { describeBlocker, getBlockedPlanEnd, hasActiveSubscription } from "@/lib/account-state";
import { findDismissals, getDismissal, isDismissed, saveDismissal } from "@/lib/admin-dismissals";
import { findOwnerEmails, hideProviderName } from "@/lib/admin-stats";
import { connectDb } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { getAccountPlan } from "@/lib/plans";
import Account from "@/models/Account";
import Alert from "@/models/Alert";
import { ATTENTION_KINDS } from "@/models/AttentionDismissal";
import Campaign from "@/models/Campaign";
import Newsletter from "@/models/Newsletter";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 7;
const TRAIL_SHOWN = 15;
// Of an alert's own occurrences in its trail: the first and the latest ones.
const OWN_SHOWN = 5;
const RELATED_SHOWN = 8;
const OBJECT_IDS = /\b[a-f0-9]{24}\b/g;
// Alert kinds whose key ends with the newsletter's slug, like embed-flood:<slug>.
const SLUG_TYPES = new Set(["embed-flood", "embed-flood-plain", "embed-plain-off", "signup-flood", "welcome-cap"]);
const CAMPAIGN_FIELDS = { accountId: 1, newsletterId: 1, subject: 1, status: 1, pauseReason: 1, startedAt: 1, finishedAt: 1, updatedAt: 1, stats: 1 };

const timeOf = (value) => (value ? new Date(value).getTime() : 0);
const latest = (...dates) => dates.filter(Boolean).sort((a, b) => timeOf(b) - timeOf(a))[0] ?? null;
const shown = (text) => hideProviderName(maskEmails(text)) || null;

function toObjectIds(ids) {
	return [...new Set(ids.filter(Boolean).map(String))].filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id));
}

// The account, newsletter and campaign an alert is about: its account, and the ids and slug in its key and details.
async function findAlertSubjects(alert) {
	const detail = alert.occurrences?.at(-1)?.detail ?? "";
	const ids = toObjectIds([alert.accountId, ...String(alert.key).match(OBJECT_IDS) ?? [], ...detail.match(OBJECT_IDS) ?? []]);
	const slug = SLUG_TYPES.has(getAlertType(alert.key)) ? String(alert.key).split(":")[1] : null;
	const [accounts, campaigns, newsletters] = await Promise.all([
		Account.find({ _id: { $in: ids } }).lean(),
		Campaign.find({ _id: { $in: ids } }).select(CAMPAIGN_FIELDS).setOptions({ crossAccount: true }).lean(),
		Newsletter.find({ $or: [{ _id: { $in: ids } }, ...(slug ? [{ slug }] : [])] })
			.select({ accountId: 1, name: 1, slug: 1 })
			.setOptions({ crossAccount: true })
			.lean(),
	]);
	const campaign = campaigns[0] ?? null;
	const newsletter = newsletters[0] ?? (campaign ? await findNewsletter(campaign.newsletterId) : null);
	const accountId = alert.accountId ?? accounts[0]?._id ?? campaign?.accountId ?? newsletter?.accountId ?? null;
	const account = accounts.find(({ _id }) => String(_id) === String(accountId)) ?? (accountId ? await Account.findById(accountId).lean() : null);
	return { account, newsletter, campaign };
}

async function findNewsletter(newsletterId) {
	if (!newsletterId) return null;
	const [newsletter] = await Newsletter.find({ _id: newsletterId }).select({ accountId: 1, name: 1, slug: 1 }).setOptions({ crossAccount: true }).lean();
	return newsletter ?? null;
}

function describeAccount(account, ownerEmail) {
	if (!account) return null;
	const isBlocked = account.status === "paused";
	return {
		id: String(account._id),
		ownerEmail: ownerEmail ?? null,
		plan: getAccountPlan(account)?.name ?? null,
		state: isBlocked ? `Blocked by ${describeBlocker(account.pausedBy)}` : hasActiveSubscription(account) ? "Active" : "No plan",
		isBlocked,
		href: `/admin?account=${account._id}`,
	};
}

function describeNewsletter(newsletter) {
	if (!newsletter) return null;
	return { id: String(newsletter._id), name: newsletter.name, slug: newsletter.slug, href: `/admin/newsletters/${newsletter._id}` };
}

function describeCampaign(campaign) {
	if (!campaign) return null;
	return {
		id: String(campaign._id),
		subject: campaign.subject || "Untitled",
		href: `/admin/campaigns/${campaign._id}`,
		status: campaign.status,
		recipients: campaign.stats?.recipients ?? null,
		delivered: campaign.stats?.delivered ?? null,
		bounced: campaign.stats?.bounced ?? null,
		complained: campaign.stats?.complained ?? null,
	};
}

// The alert's own times: its first occurrence, how many came between, and its latest ones, or what an older alert kept.
function alertTrail(alert, { isItem = true } = {}) {
	const title = hideProviderName(alert.title ?? alert.key);
	if (alert.occurrences?.length > 0) {
		const events = alert.occurrences.map(({ at, detail, emailed, telegram }, index) => {
			const text = shown(detail) ?? title;
			const isRepeat = index > 0 && text === (shown(alert.occurrences[index - 1].detail) ?? title);
			return {
				at,
				text: isRepeat ? `${title} again` : text,
				note: [emailed && "emailed", telegram && "sent to Telegram"].filter(Boolean).join(", ") || null,
				isItem,
			};
		});
		if (events.length <= OWN_SHOWN) return events;
		const listed = OWN_SHOWN - 1;
		const between = Math.max(alert.count ?? events.length, events.length) - listed;
		return [events[0], { at: events[1].at, text: `${title}: ${between} more times`, isItem }, ...events.slice(-(listed - 1))];
	}
	return [
		{ at: alert.createdAt, text: `${title}: first raised`, isItem },
		timeOf(alert.lastSentAt) > timeOf(alert.createdAt) + 1000 && { at: alert.lastSentAt, text: `${title}: raised again`, isItem },
	].filter(Boolean);
}

function accountTrail(account) {
	if (!account) return [];
	return [
		{ at: account.createdAt, text: "Account created" },
		account.pausedAt && {
			at: account.pausedAt,
			text: `Blocked by ${describeBlocker(account.pausedBy)}${account.pauseReason ? `: ${hideProviderName(account.pauseReason)}` : ""}`,
		},
		account.unblockedAt && { at: account.unblockedAt, text: "Unblocked" },
	].filter(Boolean);
}

function campaignTrail(campaign) {
	if (!campaign) return [];
	const subject = `“${campaign.subject || "Untitled"}”`;
	return [
		campaign.startedAt && { at: campaign.startedAt, text: `${subject} started sending` },
		campaign.status === "paused" && { at: campaign.updatedAt, text: `${subject} paused${campaign.pauseReason ? `: ${hideProviderName(campaign.pauseReason)}` : ""}` },
		campaign.finishedAt && { at: campaign.finishedAt, text: `${subject} finished sending` },
	].filter(Boolean);
}

function dismissalTrail(dismissal) {
	return (dismissal?.history ?? []).map(({ dismissedAt, dismissedBy }) => ({ at: dismissedAt, text: `Dismissed by ${dismissedBy ?? "an admin"}` }));
}

// The account's other alerts and campaigns around the item: from a week before it until now.
async function findRelated(accountId, { since, exceptAlertId, exceptCampaignId }) {
	if (!accountId) return [];
	const id = String(accountId);
	const [alerts, campaigns] = await Promise.all([
		Alert.find({
			_id: { $ne: exceptAlertId ?? null },
			$and: [
				{ $or: [{ accountId }, { key: { $regex: id } }] },
				{ $or: [{ lastSeenAt: { $gte: since } }, { lastSentAt: { $gte: since } }] },
			],
		})
			.sort({ lastSeenAt: -1, lastSentAt: -1 })
			.limit(RELATED_SHOWN)
			.lean(),
		Campaign.find({ accountId, _id: { $ne: exceptCampaignId ?? null }, startedAt: { $gte: since } })
			.sort({ startedAt: -1 })
			.limit(RELATED_SHOWN)
			.select(CAMPAIGN_FIELDS)
			.lean(),
	]);
	return [
		...alerts.map((alert) => ({ at: latest(alert.lastSeenAt, alert.lastSentAt), text: hideProviderName(alert.title ?? alert.key) })),
		...campaigns.flatMap(campaignTrail),
	];
}

function toTrail(events) {
	return events
		.filter(({ at }) => at)
		.sort((a, b) => timeOf(a.at) - timeOf(b.at))
		.slice(-TRAIL_SHOWN)
		.map(({ at, text, note = null, isItem = false }) => ({ at, text, note, isItem }));
}

async function describeAlert(alert, now) {
	const { account, newsletter, campaign } = await findAlertSubjects(alert);
	const owners = await findOwnerEmails([account?._id]);
	const ownerEmail = account ? (owners.get(String(account._id)) ?? null) : null;
	const latestOccurrence = alert.occurrences?.at(-1);
	const type = describeAlertType(alert.key);
	const action = shown(latestOccurrence?.action);
	const at = latest(alert.lastSeenAt, alert.lastSentAt);
	const since = new Date(Math.min(timeOf(at) || now.getTime(), now.getTime()) - WINDOW_DAYS * DAY_MS);
	const [related, dismissal, sameType] = await Promise.all([
		findRelated(account?._id, { since, exceptAlertId: alert._id, exceptCampaignId: campaign?._id }),
		findDismissals([{ kind: "alert", id: alert._id }]).then((found) => getDismissal(found, "alert", alert._id)),
		countSameType(alert, now),
	]);
	const told = [
		alert.lastSentAt && { label: alert.accountId ? "Emailed to the owner" : "Emailed to the admins", at: alert.lastSentAt },
		alert.telegramSentAt && { label: "Sent to Telegram", at: alert.telegramSentAt },
	].filter(Boolean);
	return {
		kind: "alert",
		id: String(alert._id),
		title: hideProviderName(alert.title ?? alert.key),
		at,
		count: alert.count ?? null,
		what: shown(latestOccurrence?.detail) ?? type?.what ?? null,
		action: action === type?.done ? null : action,
		done: type?.done ?? null,
		hasDetails: Boolean(latestOccurrence),
		told,
		account: describeAccount(account, ownerEmail),
		newsletter: describeNewsletter(newsletter),
		campaign: describeCampaign(campaign),
		trail: toTrail([...alertTrail(alert), ...accountTrail(account), ...campaignTrail(campaign), ...related, ...dismissalTrail(dismissal)]),
		dismissal: dismissal ? { at: dismissal.dismissedAt, by: dismissal.dismissedBy ?? null, isActive: isDismissed(dismissal, at) } : null,
		sameType,
	};
}

async function describeBlockedAccount(account, now) {
	const owners = await findOwnerEmails([account._id]);
	const since = new Date(Math.min(timeOf(account.pausedAt) || now.getTime(), now.getTime()) - WINDOW_DAYS * DAY_MS);
	const [related, dismissal, campaigns] = await Promise.all([
		findRelated(account._id, { since }),
		findDismissals([{ kind: "account", id: account._id }]).then((found) => getDismissal(found, "account", account._id)),
		Campaign.find({ accountId: account._id, status: "paused" }).sort({ updatedAt: -1 }).limit(RELATED_SHOWN).select(CAMPAIGN_FIELDS).lean(),
	]);
	const isBlocked = account.status === "paused";
	return {
		kind: "account",
		id: String(account._id),
		title: owners.get(String(account._id)) ?? "Unknown owner",
		at: account.pausedAt ?? null,
		count: null,
		what: isBlocked
			? `Blocked by ${describeBlocker(account.pausedBy)}${account.pauseReason ? `: ${hideProviderName(account.pauseReason)}` : ""}.`
			: "No longer blocked.",
		action: isBlocked ? "Unblock it from its row in Accounts once it's sorted out." : null,
		done: `Every send stopped: campaigns paused, welcome emails, imports and changes are off, and its sending space at the email provider is suspended.${account.billingPausedAt ? ` Its plan isn't billed until it's unblocked, and ends on ${formatDate(getBlockedPlanEnd(account.billingPausedAt))} if it's still blocked.` : ""}`,
		hasDetails: true,
		told: isBlocked ? [{ label: "The owner sees it on their dashboard and got an email", at: account.pausedAt }] : [],
		account: describeAccount(account, owners.get(String(account._id))),
		newsletter: null,
		campaign: null,
		trail: toTrail([
			...accountTrail(account).map((event) => ({ ...event, isItem: event.at === account.pausedAt })),
			...campaigns.flatMap(campaignTrail),
			...related,
			...dismissalTrail(dismissal),
		]),
		dismissal: dismissal ? { at: dismissal.dismissedAt, by: dismissal.dismissedBy ?? null, isActive: isDismissed(dismissal, account.pausedAt) } : null,
		sameType: null,
	};
}

async function describePausedCampaign(campaign, now) {
	const [account, newsletter] = await Promise.all([Account.findById(campaign.accountId).lean(), findNewsletter(campaign.newsletterId)]);
	const owners = await findOwnerEmails([campaign.accountId]);
	const [alert] = await Alert.find({ key: `campaign-paused-${campaign._id}` }).lean();
	const since = new Date(Math.min(timeOf(campaign.startedAt ?? campaign.updatedAt) || now.getTime(), now.getTime()) - WINDOW_DAYS * DAY_MS);
	const [related, dismissal] = await Promise.all([
		findRelated(campaign.accountId, { since, exceptAlertId: alert?._id, exceptCampaignId: campaign._id }),
		findDismissals([{ kind: "campaign", id: campaign._id }]).then((found) => getDismissal(found, "campaign", campaign._id)),
	]);
	return {
		kind: "campaign",
		id: String(campaign._id),
		title: campaign.subject || "Untitled",
		at: campaign.updatedAt,
		count: null,
		what: campaign.status === "paused" ? `It paused itself${campaign.pauseReason ? `: ${hideProviderName(campaign.pauseReason)}` : ""}.` : "It isn't paused anymore.",
		action: campaign.status === "paused" ? "Its owner can resume it from the campaign's page." : null,
		done: "Sending stopped where it was. The rest waits until the owner resumes it.",
		hasDetails: true,
		told: alert?.lastSentAt ? [{ label: "Emailed to the owner", at: alert.lastSentAt }] : [],
		account: describeAccount(account, owners.get(String(campaign.accountId))),
		newsletter: describeNewsletter(newsletter),
		campaign: describeCampaign(campaign),
		trail: toTrail([
			...campaignTrail(campaign).map((event) => ({ ...event, isItem: event.at === campaign.updatedAt })),
			...(alert ? alertTrail(alert) : []),
			...accountTrail(account),
			...related,
			...dismissalTrail(dismissal),
		]),
		dismissal: dismissal ? { at: dismissal.dismissedAt, by: dismissal.dismissedBy ?? null, isActive: isDismissed(dismissal, campaign.updatedAt) } : null,
		sameType: null,
	};
}

// The alerts of the last 7 days of the same kind as this one, not dismissed and not this one: what "Dismiss all
// like this" sets aside.
async function findSameType(alert, now) {
	const type = getAlertType(alert.key);
	const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
	const recent = await Alert.find({ $or: [{ lastSeenAt: { $gte: since } }, { lastSentAt: { $gte: since } }] })
		.select({ key: 1, lastSeenAt: 1, lastSentAt: 1 })
		.lean();
	const candidates = recent.filter(({ key }) => getAlertType(key) === type);
	const dismissals = await findDismissals(candidates.map(({ _id }) => ({ kind: "alert", id: _id })));
	return candidates.filter(({ _id, lastSeenAt, lastSentAt }) => !isDismissed(getDismissal(dismissals, "alert", _id), latest(lastSeenAt, lastSentAt)));
}

async function countSameType(alert, now) {
	const others = (await findSameType(alert, now)).filter(({ _id }) => String(_id) !== String(alert._id));
	return others.length > 0 ? { count: others.length } : null;
}

async function findItem(kind, id) {
	if (!ATTENTION_KINDS.includes(kind) || !mongoose.isValidObjectId(id)) return null;
	const _id = new mongoose.Types.ObjectId(String(id));
	if (kind === "alert") return Alert.findById(_id).lean();
	if (kind === "account") return Account.findById(_id).lean();
	const [campaign] = await Campaign.find({ _id }).select(CAMPAIGN_FIELDS).setOptions({ crossAccount: true }).lean();
	return campaign ?? null;
}

function getItemTime(kind, item) {
	if (kind === "alert") return latest(item.lastSeenAt, item.lastSentAt);
	if (kind === "account") return item.pausedAt ?? null;
	return item.updatedAt ?? null;
}

// What the admin page's dialog shows for an item of "Needs a look", or null when there's no such item. Admins only:
// the caller checks (app/admin/actions.js).
export async function getAttentionDetails({ kind, id, now = new Date() }) {
	await connectDb();
	const item = await findItem(kind, id);
	if (!item) return null;
	if (kind === "alert") return describeAlert(item, now);
	if (kind === "account") return describeBlockedAccount(item, now);
	return describePausedCampaign(item, now);
}

// Sets it aside as it stands now: it comes back when it happens again. False when there's no such item.
export async function dismissAttention({ kind, id, by, now = new Date() }) {
	await connectDb();
	const item = await findItem(kind, id);
	if (!item) return false;
	await saveDismissal({ kind, targetId: item._id, itemAt: getItemTime(kind, item), by, now });
	return true;
}

// This alert and every other one of its kind still showing. How many were set aside, or null for no such alert.
export async function dismissAlertType({ id, by, now = new Date() }) {
	await connectDb();
	const alert = await findItem("alert", id);
	if (!alert) return null;
	const targets = [alert, ...(await findSameType(alert, now)).filter(({ _id }) => String(_id) !== String(alert._id))];
	for (const target of targets) {
		await saveDismissal({ kind: "alert", targetId: target._id, itemAt: getItemTime("alert", target), by, now });
	}
	return targets.length;
}
