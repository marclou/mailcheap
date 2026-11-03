import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { scoped, withTeamAccess } from "@/lib/account-scope";
import { requireAccount } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { NEWSLETTER_COOKIE, NEWSLETTER_SUMMARY_FIELDS, getNewsletterPagePath, getSwitchPath, pickNewsletter } from "@/lib/newsletters";
import { findSharedNewsletters } from "@/lib/team";
import { OWNER_ROLE, hasRole } from "@/lib/team-rules";
import { isObjectIdString } from "@/lib/validation";
import Account from "@/models/Account";
import Newsletter from "@/models/Newsletter";

const FIELDS = `${NEWSLETTER_SUMMARY_FIELDS} accountId fromName postalAddress archiveEnabled archiveHost createdAt dismissedNudges getStarted`;
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 3600;

// The newsletter the dashboard shows: the one the cookie names when the user can open it, else their account's first,
// else the first shared with them. newsletters: theirs, then those shared with them, each with its team access
// (lib/team.js). The open one decides the account the dashboard works in: theirs, or for a shared one its owner's,
// carrying their access (lib/account-scope.js), and role, theirs on it. ownAccount: theirs either way. savedId is the
// cookie as this request read it, so the newsletter menu can tell when a link or another tab changed it.
export const getSelectedNewsletter = cache(async () => {
	const [current, cookieStore] = await Promise.all([requireAccount(), cookies(), connectDb()]);
	const [own, shared] = await Promise.all([
		Newsletter.find(scoped(current.account)).sort({ createdAt: 1, _id: 1 }).select(FIELDS).lean(),
		findSharedNewsletters(current.user.id, FIELDS),
	]);
	const newsletters = [...own, ...shared];
	const savedId = cookieStore.get(NEWSLETTER_COOKIE)?.value ?? null;
	const selected = pickNewsletter(newsletters, savedId);
	const view = { ...current, ownAccount: current.account, newsletters, ownCount: own.length, savedId, selected, role: OWNER_ROLE };
	if (!selected?.team) return view;
	const owner = await Account.findById(selected.team.accountId).lean();
	const { role, memberId } = selected.team;
	return { ...view, account: withTeamAccess(owner, { newsletterId: selected._id, role, memberId }), role };
});

// A page only some roles open on the open newsletter: the others land on its overview.
export async function requireRole(needed) {
	const view = await getSelectedNewsletter();
	if (!hasRole(view.role, needed)) redirect("/");
	return view;
}

// A page showing another newsletter than the open one (a campaign's, or ?newsletter= in an old link) goes through
// /newsletters/<id>, which opens it: the menu and the page then show the same newsletter. An ID that isn't one the
// user can open changes nothing.
export function openNewsletter({ newsletters, selected }, id, path) {
	const value = id ? String(id) : null;
	if (!value || value === String(selected?._id) || !newsletters.some(({ _id }) => String(_id) === value)) return;
	redirect(getNewsletterPagePath(value, path));
}

// A campaign, contact or segment by ID, of any newsletter the user can open: their own, or one shared with them. The page
// then opens its newsletter (openNewsletter) and shows it only once it's the open one.
export function findInNewsletters({ newsletters }, Model, id) {
	if (!isObjectIdString(String(id ?? "")) || newsletters.length === 0) return null;
	const owned = newsletters.map(({ _id, accountId }) => ({ accountId, newsletterId: _id }));
	return Model.findOne({ _id: id, $or: owned }).setOptions({ crossAccount: true }).lean();
}

// Pages can't set cookies: server actions and route handlers call this. Null when the signed-in user can't open that
// newsletter: it's neither theirs nor shared with them.
export async function saveSelectedNewsletter(id) {
	const value = String(id ?? "");
	if (!isObjectIdString(value)) return null;
	const [{ user, account }] = await Promise.all([requireAccount(), connectDb()]);
	const newsletter =
		(await Newsletter.findOne(scoped(account, { _id: value })).select({ _id: 1 }).lean()) ??
		(await findSharedNewsletters(user.id, "_id")).find(({ _id }) => String(_id) === value) ??
		null;
	if (!newsletter) return null;
	(await cookies()).set(NEWSLETTER_COOKIE, value, { maxAge: COOKIE_MAX_AGE_SECONDS, sameSite: "lax" });
	return newsletter;
}

// The newsletter menu: on one of a newsletter's pages, the same page of the other one opens; the account's own
// pages stay where they are.
export async function switchNewsletter(id, pathname) {
	if (!(await saveSelectedNewsletter(id))) return { error: "Newsletter not found" };
	const path = getSwitchPath(String(pathname ?? ""));
	if (path) redirect(path);
	return { ok: true };
}
