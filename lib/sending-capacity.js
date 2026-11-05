import "server-only";
import { LIMITS, getEmailProviderId } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { isEmailProviderConfigured } from "@/lib/email-provider";
import { getClusters } from "@/lib/email-provider/postshiba";
import { CAMPAIGN_MESSAGE_KINDS } from "@/lib/sending-rules";
import { getSesAccount } from "@/lib/ses";
import Message from "@/models/Message";

const HOUR_MS = 3_600_000;

// The email provider's caps, which every account shares, against what went out through them. For the admin page, so
// nothing in it names the provider, its clusters or its tenants, errors included: those go to the server's log.
export async function getSendingCapacity({ now = new Date(), fresh = false } = {}) {
	try {
		if (!isEmailProviderConfigured()) return { error: "unconfigured" };
		// On SendHQ: the rate MailCheap keeps to.
		if (getEmailProviderId() === "sendhq") return { lanes: [{ label: "All emails", status: null, meters: [], perSecond: LIMITS.sendRatePerSecond }] };
		return getEmailProviderId() === "ses" ? await readSesCapacity({ fresh }) : await readClusterCapacity({ now, fresh });
	} catch (error) {
		console.error(`[admin] Couldn't read the sending capacity: ${error.message}`);
		return { error: "unreadable" };
	}
}

// PostShiba doesn't say how much of a cap is used, so it's what MailCheap handed it: every account's emails, test ones
// included. Campaigns go to the bulk cluster, every other email to the transactional one.
async function readClusterCapacity({ now, fresh }) {
	const [clusters, sent] = await Promise.all([getClusters({ fresh }), countSent(now)]);
	if (clusters.error) throw new Error(clusters.error);
	if (clusters.isSingle) {
		const all = { hour: sent.campaigns.hour + sent.other.hour, day: sent.campaigns.day + sent.other.day };
		return { lanes: [toClusterLane("All emails", clusters.bulk, all)] };
	}
	return {
		lanes: [
			toClusterLane("Campaigns", clusters.bulk, sent.campaigns),
			toClusterLane("Signup and test emails", clusters.transactional, sent.other),
		],
	};
}

async function countSent(now) {
	await connectDb();
	const hourAgo = new Date(now.getTime() - HOUR_MS);
	const rows = await Message.aggregate([
		{ $match: { sentAt: { $gt: new Date(now.getTime() - 24 * HOUR_MS), $lte: now } } },
		{
			$group: {
				_id: { $in: ["$kind", CAMPAIGN_MESSAGE_KINDS] },
				hour: { $sum: { $cond: [{ $gt: ["$sentAt", hourAgo] }, 1, 0] } },
				day: { $sum: 1 },
			},
		},
	]).option({ crossAccount: true });
	const countsFor = (isCampaign) => rows.find(({ _id }) => _id === isCampaign) ?? { hour: 0, day: 0 };
	return { campaigns: countsFor(true), other: countsFor(false) };
}

function toClusterLane(label, cluster, sent) {
	return {
		label,
		status: describeCluster(cluster),
		meters: [
			{ label: "Last hour", used: sent.hour, cap: cluster.emails_per_hour ?? 0 },
			{ label: "Last 24 hours", used: sent.day, cap: cluster.emails_per_day ?? 0 },
		],
		perSecond: null,
	};
}

// status: a BadgeStatus status, for its color.
function describeCluster(cluster) {
	if (cluster.status === "suspended") return { status: "blocked", label: "Suspended" };
	return cluster.sending_ready && cluster.status === "active" ? null : { status: "paused", label: "Not ready" };
}

// SES has one quota for every email and counts what went out against it itself.
async function readSesCapacity({ fresh }) {
	const account = await getSesAccount({ fresh });
	if (account.error) throw new Error(account.error);
	return {
		lanes: [
			{
				label: "All emails",
				status: describeSesAccount(account),
				meters: [{ label: "Last 24 hours", used: account.sentLast24Hours, cap: account.max24HourSend }],
				perSecond: account.maxSendRate,
			},
		],
	};
}

function describeSesAccount(account) {
	if (account.enforcementStatus === "SHUTDOWN") return { status: "shutdown", label: "Shut down" };
	if (!account.sendingEnabled) return { status: "blocked", label: "Sending paused" };
	if (account.enforcementStatus === "PROBATION") return { status: "probation", label: "On probation" };
	if (!account.productionAccess) return { status: "sandbox", label: account.reviewStatus === "PENDING" ? "Sandbox, in review" : "Sandbox" };
	return null;
}
