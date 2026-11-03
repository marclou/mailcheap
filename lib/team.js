import "server-only";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { scoped } from "@/lib/account-scope";
import { isDeletionPending } from "@/lib/account-state";
import { AUTH_MODELS, findOwnerEmail, findUser, isUserAllowed } from "@/lib/accounts";
import { actionError } from "@/lib/actions/errors";
import { APP_NAME, getAppUrl, isCloud, isEmailAllowed } from "@/lib/config";
import { getSignupProblem } from "@/lib/contacts";
import { connectDb } from "@/lib/db";
import { getDomainLists } from "@/lib/domain-lists";
import { classifyDomain } from "@/lib/domain-reputation";
import { getCanonicalEmail } from "@/lib/email-aliases";
import { formatWindow } from "@/lib/format";
import { canSendPlatformEmail, sendPlatformEmail } from "@/lib/platform-email";
import { isRateLimited } from "@/lib/rate-limit";
import { escapeHtml } from "@/lib/render-email";
import { INVITATION_DAYS, MAX_TEAM_MEMBERS, getInvitationExpiry, getJoinPath, getMemberStatus } from "@/lib/team-rules";
import { isObjectIdString, normalizeEmail } from "@/lib/validation";
import Account from "@/models/Account";
import Newsletter from "@/models/Newsletter";
import TeamMember from "@/models/TeamMember";

// On top of invite_team_member's own limit an hour (lib/actions/team.js): an account's invitations a day, and an inbox's
// from every account together, so nobody gets more than a few whoever sends them.
export const INVITES_PER_ACCOUNT = { name: "team-invites-account", limit: 20, window: "1 d" };
export const INVITES_PER_INBOX = { name: "team-invites-inbox", limit: 3, window: "1 d" };
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ROLE_LINES = {
	admin: "You'll write and send its issues, look after its contacts and change its settings.",
	member: "You'll write and edit its drafts, send tests to yourself, and add and edit its contacts.",
};

function toObjectId(id) {
	return new mongoose.Types.ObjectId(String(id));
}

// The link's token is in the email alone: only its hash is kept, like an API key's.
export function hashInvitationToken(token) {
	return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function generateInvitationToken() {
	const token = crypto.randomBytes(32).toString("base64url");
	return { token, hash: hashInvitationToken(token) };
}

// Two addresses that reach the same inbox (lib/email-aliases.js): signing in with one proves the other.
export function isSameInbox(a, b) {
	const inbox = getCanonicalEmail(a);
	return Boolean(inbox) && inbox === getCanonicalEmail(b);
}

// A name or a newsletter's name on one line, as an email's subject and text show it.
function oneLine(value, max) {
	return String(value ?? "")
		.replace(/[\s\p{Cc}]+/gu, " ")
		.trim()
		.slice(0, max);
}

// A newsletter's team: everyone but those removed, first invited first.
export function listTeam(account, newsletterId) {
	return TeamMember.find(scoped(account, { newsletterId, removedAt: null })).sort({ createdAt: 1, _id: 1 }).lean();
}

export function findTeamMember(account, newsletterId, id) {
	if (!isObjectIdString(String(id ?? ""))) return null;
	return TeamMember.findOne(scoped(account, { _id: id, newsletterId, removedAt: null })).lean();
}

// The pictures and names of a team's members who joined, by their user's ID, for the Team page.
export async function findMemberUsers(members) {
	const ids = members.filter(({ userId }) => userId).map(({ userId }) => userId);
	if (ids.length === 0) return new Map();
	const users = await mongoose.connection.db
		.collection(AUTH_MODELS.user)
		.find({ _id: { $in: ids } }, { projection: { name: 1, image: 1 } })
		.toArray();
	return new Map(users.map((user) => [String(user._id), user]));
}

// What the invitation can't go to: an address that can't sign in here or can't get it, or a throwaway inbox.
async function getInviteeProblem(email) {
	if (!isEmailAllowed(email)) return `Only the emails this server allows can sign in: add ${email} to ALLOWED_EMAILS first`;
	const problem = await getSignupProblem(email);
	if (problem) return problem;
	if (classifyDomain(email.split("@")[1], await getDomainLists()) === "disposable") return "Throwaway inboxes can't join a team";
	return null;
}

export function renderInvitationEmail({ newsletterName, ownerEmail, name, email, role, url }) {
	const newsletter = oneLine(newsletterName, 100);
	const lines = [
		`Hi ${oneLine(name, 60)},`,
		`${ownerEmail} invited you to work on ${newsletter} with them on ${APP_NAME}, as ${role === "admin" ? "an admin" : "a member"}. ${ROLE_LINES[role]}`,
	];
	const after = `The link works for ${INVITATION_DAYS} days: sign in with ${email} to join. If you weren't expecting it, you can ignore this email.`;
	const button = `Join ${newsletter}`;
	return {
		subject: `Join ${newsletter} on ${APP_NAME}`,
		text: [...lines, `${button}: ${url}`, after].join("\n\n"),
		html: `<div style="max-width:460px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#18181b">${lines.map((line) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6">${escapeHtml(line)}</p>`).join("")}<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#18181b;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">${escapeHtml(button)}</a></p><p style="margin:0;font-size:13px;line-height:1.5;color:#71717a">${escapeHtml(after)}</p></div>`,
	};
}

// Adds someone to a newsletter's team, or sends a pending invitation again with its new name and role, and emails them
// the link. The address goes through a signup's checks, and the limits above count each email.
export async function inviteTeamMember({ account, newsletter, name, email: value, role }) {
	const email = normalizeEmail(value);
	if (!email) throw actionError("validation_failed", "email is invalid");
	if (!canSendPlatformEmail()) throw actionError("unavailable", "This server can't send MailCheap's own emails, so it can't send invitations");
	const ownerEmail = await findOwnerEmail(account._id);
	if (isSameInbox(email, ownerEmail)) throw actionError("validation_failed", "That's your own address: you already have this newsletter");
	const problem = await getInviteeProblem(email);
	if (problem) throw actionError("validation_failed", problem);

	const team = await TeamMember.find(scoped(account, { newsletterId: newsletter._id })).lean();
	const existing = team.find((member) => isSameInbox(member.email, email)) ?? null;
	const isPending = Boolean(existing && !existing.removedAt && !existing.joinedAt);
	if (existing && !existing.removedAt && existing.joinedAt) {
		throw actionError("conflict", `${existing.email} is already on this newsletter's team: change their role instead`);
	}
	if (!isPending && team.filter(({ removedAt }) => !removedAt).length >= MAX_TEAM_MEMBERS) {
		throw actionError("conflict", `A newsletter's team has ${MAX_TEAM_MEMBERS} people at most. Remove someone to invite someone else.`);
	}
	if (await isRateLimited({ ...INVITES_PER_ACCOUNT, key: String(account._id) })) {
		throw actionError("rate_limited", `You can send ${INVITES_PER_ACCOUNT.limit} invitations ${formatWindow(INVITES_PER_ACCOUNT.window)}. Try again tomorrow.`);
	}
	if (await isRateLimited({ ...INVITES_PER_INBOX, key: getCanonicalEmail(email) })) {
		throw actionError("rate_limited", "This address got enough invitations today. Try again tomorrow.");
	}

	const { token, hash } = generateInvitationToken();
	const now = new Date();
	const invitation = { email, name, role, invitedAt: now, tokenHash: hash, expiresAt: getInvitationExpiry(now) };
	let member;
	try {
		member = existing
			? await TeamMember.findOneAndUpdate(
					scoped(account, { _id: existing._id }),
					{ $set: invitation, $unset: { removedAt: 1, userId: 1, joinedAt: 1 } },
					{ returnDocument: "after", runValidators: true }
				).lean()
			: (await TeamMember.create({ accountId: account._id, newsletterId: newsletter._id, ...invitation })).toObject();
	} catch (error) {
		if (error?.code === 11000) throw actionError("conflict", `${email} is already invited`);
		throw error;
	}
	// Two invitations at once could both pass the count above: the later one goes.
	if (!isPending && (await TeamMember.countDocuments(scoped(account, { newsletterId: newsletter._id, removedAt: null }))) > MAX_TEAM_MEMBERS) {
		await TeamMember.updateOne(scoped(account, { _id: member._id }), { $set: { removedAt: new Date() }, $unset: { tokenHash: 1, expiresAt: 1 } });
		throw actionError("conflict", `A newsletter's team has ${MAX_TEAM_MEMBERS} people at most. Remove someone to invite someone else.`);
	}

	const url = `${getAppUrl()}${getJoinPath(token)}`;
	try {
		await sendPlatformEmail({ to: email, replyTo: ownerEmail, ...renderInvitationEmail({ newsletterName: newsletter.name, ownerEmail, name, email, role, url }) });
	} catch (error) {
		console.error("[team] Could not send an invitation:", error.message);
		throw actionError("unavailable", "Couldn't send the invitation. Try again in a minute.");
	}
	return member;
}

// What an owner can change about someone on the team: their role, and the name the team shows.
export async function updateTeamMember(account, member, { role, name }) {
	const set = { ...(role && { role }), ...(name && { name }) };
	if (Object.keys(set).length === 0) return member;
	return TeamMember.findOneAndUpdate(scoped(account, { _id: member._id, removedAt: null }), { $set: set }, { returnDocument: "after", runValidators: true }).lean();
}

// Their access ends at their next click, and a pending invitation's link stops working. Kept, like every customer
// document, until the address is invited again.
export async function removeTeamMember(account, member) {
	const { matchedCount } = await TeamMember.updateOne(scoped(account, { _id: member._id, removedAt: null }), {
		$set: { removedAt: new Date() },
		$unset: { tokenHash: 1, expiresAt: 1 },
	});
	return matchedCount > 0;
}

// The newsletters shared with a user, which the dashboard's menu lists after their own, each with its team access. Only
// those of accounts that still open: not being deleted, not the user's own, and on a self-hosted server, with an owner
// still on the allowlist.
export async function findSharedNewsletters(userId, fields) {
	await connectDb();
	const memberships = await TeamMember.find({ userId: toObjectId(userId), joinedAt: { $ne: null }, removedAt: null })
		.setOptions({ crossAccount: true })
		.select({ accountId: 1, newsletterId: 1, role: 1 })
		.lean();
	if (memberships.length === 0) return [];
	const [newsletters, accounts] = await Promise.all([
		Newsletter.find({ _id: { $in: memberships.map(({ newsletterId }) => newsletterId) } })
			.setOptions({ crossAccount: true })
			.sort({ createdAt: 1, _id: 1 })
			.select(`${fields} accountId createdAt`)
			.lean(),
		Account.find({ _id: { $in: memberships.map(({ accountId }) => accountId) } }).select({ ownerId: 1, deletion: 1 }).lean(),
	]);
	const open = new Set();
	for (const account of accounts) {
		if (isDeletionPending(account) || String(account.ownerId) === String(userId)) continue;
		if (!isCloud() && !isUserAllowed(await findUser(account.ownerId))) continue;
		open.add(String(account._id));
	}
	return newsletters.flatMap((newsletter) => {
		const membership = memberships.find(({ newsletterId, accountId }) => newsletterId.equals(newsletter._id) && accountId.equals(newsletter.accountId));
		if (!membership || !open.has(String(newsletter.accountId))) return [];
		return [{ ...newsletter, team: { role: membership.role, memberId: String(membership._id), accountId: String(newsletter.accountId) } }];
	});
}

// The invitation behind a link while it can be accepted, with its newsletter and the owner's address.
export async function findInvitation(token) {
	if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;
	await connectDb();
	const member = await TeamMember.findOne({ tokenHash: hashInvitationToken(token), removedAt: null, joinedAt: null })
		.setOptions({ crossAccount: true })
		.lean();
	if (!member) return null;
	const [newsletter, account] = await Promise.all([
		Newsletter.findOne(scoped(member.accountId, { _id: member.newsletterId })).select({ name: 1, slug: 1, imageUrl: 1 }).lean(),
		Account.findById(member.accountId).select({ ownerId: 1, deletion: 1 }).lean(),
	]);
	if (!newsletter || !account || isDeletionPending(account)) return null;
	return { member, newsletter, ownerId: String(account.ownerId), ownerEmail: await findOwnerEmail(account._id), isExpired: getMemberStatus(member) === "expired" };
}

// Joins the newsletter's team as the signed-in user, who proved the invited address by signing in with it (or with an
// address of the same inbox). The token goes once it's used. Answers the newsletter's ID, or why it can't.
export async function acceptInvitation({ token, user }) {
	const invitation = await findInvitation(token);
	if (!invitation || invitation.isExpired) return { error: "This invitation isn't valid anymore. Ask for a new one." };
	const { member } = invitation;
	if (!user?.emailVerified || !isSameInbox(user.email, member.email)) return { error: `This invitation is for ${member.email}` };
	if (invitation.ownerId === String(user.id)) return { error: "You own this newsletter already" };
	const { modifiedCount } = await TeamMember.updateOne(
		scoped(member.accountId, { _id: member._id, tokenHash: member.tokenHash, removedAt: null, joinedAt: null }),
		{ $set: { userId: toObjectId(user.id), joinedAt: new Date() }, $unset: { tokenHash: 1, expiresAt: 1 } }
	);
	if (!modifiedCount) return { error: "This invitation isn't valid anymore. Ask for a new one." };
	return { newsletterId: String(member.newsletterId) };
}

// A deleted user's memberships go with them: their access, and the rows the owners' Team pages listed them in.
export async function removeUserMemberships(userId) {
	await TeamMember.updateMany(
		{ userId: toObjectId(userId), removedAt: null },
		{ $set: { removedAt: new Date() }, $unset: { tokenHash: 1, expiresAt: 1 } }
	).setOptions({ crossAccount: true });
}
