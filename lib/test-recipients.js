import "server-only";
import { getTeamAccess, scoped } from "@/lib/account-scope";
import { findOwnerEmail } from "@/lib/accounts";
import { actionError } from "@/lib/actions/errors";
import { FINAL_STATUSES, findDeletedStatuses, getSignupProblem } from "@/lib/contacts";
import { getCanonicalEmail } from "@/lib/email-aliases";
import { formatNumber } from "@/lib/format";
import { getSignupScale } from "@/lib/plans";
import { isRateLimited } from "@/lib/rate-limit";
import { hasRole } from "@/lib/team-rules";
import { OUTSIDE_TEST_ADDRESSES_PER_DAY, TESTS_PER_OUTSIDE_ADDRESS_PER_DAY } from "@/lib/test-email-rules";
import { normalizeEmail } from "@/lib/validation";
import Account from "@/models/Account";
import Contact from "@/models/Contact";
import Message from "@/models/Message";
import Suppression from "@/models/Suppression";
import TeamMember from "@/models/TeamMember";

const TESTS_PER_OUTSIDE_INBOX = { name: "test-emails-inbox", limit: TESTS_PER_OUTSIDE_ADDRESS_PER_DAY, window: "1 d" };
const DAY_MS = 24 * 60 * 60 * 1000;

// Where someone's tests go when they don't name addresses: the ones they saved, else their own address, the owner's
// when an API key asks. The owner's are saved on the account, a team member's on their membership.
export async function findDefaultTestRecipients({ account, user }) {
	const team = getTeamAccess(account);
	const saved = team
		? (await TeamMember.findOne(scoped(account, { _id: team.memberId })).select({ testRecipients: 1 }).lean())?.testRecipients
		: account.testRecipients;
	if (saved?.length > 0) return saved;
	const own = user?.email ?? (await findOwnerEmail(account._id));
	return own ? [own] : [];
}

export async function saveDefaultTestRecipients(account, emails) {
	const team = getTeamAccess(account);
	if (team) await TeamMember.updateOne(scoped(account, { _id: team.memberId }), { $set: { testRecipients: emails } });
	else await Account.updateOne({ _id: account._id }, { $set: { testRecipients: emails } });
}

// Who a test of the newsletter goes to: to, else the sender's default. The account's own people always get it: its
// owner and whoever joined one of its newsletters' teams. A member sends to the newsletter's team alone, as they don't
// send its issues. Anyone else gets a few a day at most, OUTSIDE_TEST_ADDRESSES_PER_DAY of them a day as the plan has
// it, and nobody who left the newsletter, bounced or complained, or whose signup would be refused.
export async function checkTestRecipients({ account, user, newsletterId, to }) {
	const emails = to?.length > 0 ? readAddresses(to) : await findDefaultTestRecipients({ account, user });
	if (emails.length === 0) throw actionError("validation_failed", "to: add the address the test goes to");
	const team = await findTeamInboxes(account, newsletterId, user);
	const role = getTeamAccess(account)?.role;
	const notOnTeam = emails.find((email) => !team.newsletter.has(getCanonicalEmail(email)));
	if (role && !hasRole(role, "admin") && notOnTeam) {
		throw actionError("forbidden", `Only the newsletter's admins send tests outside its team, and ${notOnTeam} isn't on it`);
	}
	const outside = emails.filter((email) => !team.account.has(getCanonicalEmail(email)));
	if (outside.length === 0) return emails;
	for (const email of outside) {
		const problem = await getOutsideProblem(account, newsletterId, email);
		if (problem) throw actionError("validation_failed", `${email}: ${problem}`);
	}
	const cap = OUTSIDE_TEST_ADDRESSES_PER_DAY * getSignupScale(account);
	const reached = await findRecentOutsideInboxes(account, team.account);
	const added = new Set(outside.map(getCanonicalEmail).filter((inbox) => !reached.has(inbox)));
	if (reached.size + added.size > cap) {
		throw actionError("rate_limited", `Your tests reach ${formatNumber(cap)} addresses outside your team a day. Try again tomorrow.`);
	}
	for (const email of outside) {
		if (await isRateLimited({ ...TESTS_PER_OUTSIDE_INBOX, key: getCanonicalEmail(email) })) {
			throw actionError("rate_limited", `${email} got enough test emails today. Try again tomorrow.`);
		}
	}
	return emails;
}

function readAddresses(to) {
	const emails = [];
	for (const value of to) {
		const email = normalizeEmail(value);
		if (!email) throw actionError("validation_failed", `to: ${JSON.stringify(String(value).slice(0, 100))} isn't an email address`);
		if (!emails.includes(email)) emails.push(email);
	}
	return emails;
}

// The inboxes of the account's own people: its owner, whoever asks, and the members who joined its newsletters'
// teams (account), or this newsletter's (newsletter).
async function findTeamInboxes(account, newsletterId, user) {
	const [ownerEmail, members] = await Promise.all([
		findOwnerEmail(account._id),
		TeamMember.find(scoped(account, { joinedAt: { $ne: null }, removedAt: null })).select({ email: 1, newsletterId: 1 }).lean(),
	]);
	const own = [ownerEmail, user?.email];
	const isOnNewsletter = (member) => String(member.newsletterId) === String(newsletterId);
	return {
		account: toInboxes([...own, ...members.map(({ email }) => email)]),
		newsletter: toInboxes([...own, ...members.filter(isOnNewsletter).map(({ email }) => email)]),
	};
}

function toInboxes(emails) {
	return new Set(emails.map(getCanonicalEmail).filter(Boolean));
}

async function getOutsideProblem(account, newsletterId, email) {
	const [isSuppressed, contact, deleted] = await Promise.all([
		Suppression.exists(scoped(account, { email })),
		Contact.findOne(scoped(account, { newsletterId, email })).select({ status: 1 }).lean(),
		findDeletedStatuses({ accountId: account._id, newsletterId, emails: [email] }),
	]);
	if (isSuppressed || FINAL_STATUSES.includes(contact?.status) || deleted.size > 0) return "This address unsubscribed, bounced or complained before";
	return getSignupProblem(email);
}

// The inboxes outside the team the account's tests went to in the last day.
async function findRecentOutsideInboxes(account, teamInboxes) {
	const emails = await Message.distinct("email", scoped(account, { kind: "test", createdAt: { $gte: new Date(Date.now() - DAY_MS) } }));
	return new Set(emails.map(getCanonicalEmail).filter((inbox) => inbox && !teamInboxes.has(inbox)));
}
