import { isDeletionPending } from "@/lib/account-state";
import { getCurrentAccount } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { gravatarHash } from "@/lib/gravatar";
import { removePresence, updatePresence } from "@/lib/presence";
import { readPresenceState } from "@/lib/presence-rules";
import { isRateLimited } from "@/lib/rate-limit";
import { findSharedNewsletters, hasTeam } from "@/lib/team";
import { isObjectIdString } from "@/lib/validation";
import Campaign from "@/models/Campaign";

// Several a second while someone moves on a draft others are on, from each tab they have it open in.
const PRESENCE_LIMIT = { name: "draft-presence", limit: 600, window: "1 m" };
const EDITABLE_STATUSES = ["draft", "scheduled"];

// A draft its user can be on with others: one of their own newsletters' with someone on its team, or one of a
// newsletter shared with them (lib/team.js).
async function findTeamDraft({ user, account }, id) {
	if (!isObjectIdString(String(id))) return null;
	await connectDb();
	const campaign = await Campaign.findOne({ _id: id, status: { $in: EDITABLE_STATUSES } })
		.setOptions({ crossAccount: true })
		.select({ accountId: 1, newsletterId: 1, revision: 1 })
		.lean();
	if (!campaign) return null;
	if (campaign.accountId.equals(account._id)) return (await hasTeam(account, campaign.newsletterId)) ? campaign : null;
	const shared = await findSharedNewsletters(user.id, "_id");
	return shared.some(({ _id, accountId }) => _id.equals(campaign.newsletterId) && accountId.equals(campaign.accountId)) ? campaign : null;
}

// Archives on <slug>.<shared domain> are the same site as the dashboard when the shared domain is the app's own, so
// the session cookie comes with their requests too: only the dashboard's own pages say where someone is.
async function findContext(request, params) {
	const site = request.headers.get("sec-fetch-site");
	if (site && site !== "same-origin") return { failure: Response.json({ error: "Forbidden" }, { status: 403 }) };
	const current = await getCurrentAccount();
	if (!current || isDeletionPending(current.account)) return { failure: Response.json({ error: "Unauthorized" }, { status: 401 }) };
	if (await isRateLimited({ ...PRESENCE_LIMIT, key: String(current.user.id) })) {
		return { failure: Response.json({ error: "Too many requests" }, { status: 429 }) };
	}
	const campaign = await findTeamDraft(current, (await params).id);
	if (!campaign) return { failure: Response.json({ error: "Not found" }, { status: 404 }) };
	return { user: current.user, campaign };
}

// Their name and picture, never their address: the photo they uploaded, their Gravatar's, or their initial.
function toPerson(user) {
	return {
		id: String(user.id),
		name: user.name?.trim() || String(user.email).split("@")[0],
		image: user.image || null,
		gravatarHash: gravatarHash(user.email),
	};
}

// A team draft's editor says where its person is, every few seconds and as they move, and gets back everyone else on
// it and the draft's revision, which tells it someone else saved (lib/use-draft-sync.js).
export async function POST(request, { params }) {
	const { failure, user, campaign } = await findContext(request, params);
	if (failure) return failure;
	const body = await request.json().catch(() => null);
	const entry = { ...toPerson(user), ...readPresenceState(body), at: Date.now() };
	const everyone = await updatePresence(String(campaign._id), entry);
	const others = everyone.filter(({ id }) => id !== entry.id).map(({ at, ...person }) => person);
	return Response.json({ others, revision: campaign.revision ?? 0 });
}

// They closed the draft: the others see them leave without waiting for them to time out.
export async function DELETE(request, { params }) {
	const { failure, user, campaign } = await findContext(request, params);
	if (failure) return failure;
	await removePresence(String(campaign._id), String(user.id));
	return new Response(null, { status: 204 });
}
