"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { scoped } from "@/lib/account-scope";
import { runAccountAction, toFormError } from "@/lib/actions/dashboard";
import { requireAccount } from "@/lib/auth";
import { LIST_SIZES, LIST_SOURCES, OTHER_LIST_SOURCE, findFreeSlug, needsOnboarding } from "@/lib/onboarding";
import { OWN_DOMAIN_STEPS } from "@/lib/sender-rules";
import { siteExtensions } from "@/lib/site-extensions";
import { isObjectIdString } from "@/lib/validation";
import Account from "@/models/Account";
import Newsletter from "@/models/Newsletter";

function readText(formData, key) {
	return String(formData.get(key) ?? "").trim();
}

function readChoice(formData, key, choices) {
	const value = readText(formData, key);
	return choices.includes(value) ? value : null;
}

// Creates the account's newsletter, keeps what it said about its list, then opens the dashboard. Sent twice,
// the second time only finishes: the newsletter is there.
export async function completeOnboarding(_state, formData) {
	const { account } = await requireAccount();
	const name = readText(formData, "name");
	if (!name) return { error: "Name your newsletter" };
	if (await needsOnboarding(account)) {
		const { failure } = await runAccountAction("create_newsletter", {
			name,
			slug: await findFreeSlug(name),
			description: readText(formData, "description"),
			fromName: readText(formData, "fromName"),
		});
		if (failure) return toFormError(failure);
		await siteExtensions.sendGoalOnNextPage("onboarding_completed");
	}

	const listSize = readChoice(formData, "listSize", LIST_SIZES.map(({ id }) => id));
	const listSource = listSize && listSize !== "none" ? readChoice(formData, "listSource", [...LIST_SOURCES, OTHER_LIST_SOURCE]) : null;
	await Account.updateOne(
		{ _id: account._id },
		{
			$set: {
				"onboarding.completedAt": new Date(),
				...(listSize && { "onboarding.listSize": listSize }),
				...(listSource && { "onboarding.listSource": listSource }),
			},
		}
	);
	redirect("/");
}

// The get-started panel of one of the account's newsletters, hidden on the newsletter so it stays hidden on every
// device. Its other newsletters keep theirs.
export async function dismissGetStarted(newsletterId) {
	const id = String(newsletterId ?? "");
	if (!isObjectIdString(id)) return { error: "Couldn't close it" };
	const { account } = await requireAccount();
	await Newsletter.updateOne(
		scoped(account, { _id: id, "getStarted.dismissedAt": null }),
		{ $set: { "getStarted.dismissedAt": new Date() } }
	);
	revalidatePath("/", "layout");
	return { ok: true };
}

// The own-domain helper of one of the account's newsletters, closed for the step it suggested (lib/sender-rules.js).
// Kept on the newsletter so it stays closed on every device until the step changes. The helper hides itself as it
// closes, so no page renders again.
export async function dismissOwnDomainNudge(newsletterId, step) {
	const id = String(newsletterId ?? "");
	if (!isObjectIdString(id) || !OWN_DOMAIN_STEPS.includes(step)) return { error: "Couldn't close it" };
	const { account } = await requireAccount();
	await Newsletter.updateOne(scoped(account, { _id: id }), { $set: { "dismissedNudges.ownDomain": step } });
	return { ok: true };
}

// The inbox check at the dashboard's bottom right (lib/inbox-check.js), closed for good for one of the account's
// newsletters. The layout renders again, so the corner moves on to what waits for it.
export async function dismissInboxCheck(newsletterId) {
	const id = String(newsletterId ?? "");
	if (!isObjectIdString(id)) return { error: "Couldn't close it" };
	const { account } = await requireAccount();
	await Newsletter.updateOne(scoped(account, { _id: id, "dismissedNudges.inboxCheck": null }), { $set: { "dismissedNudges.inboxCheck": new Date() } });
	revalidatePath("/", "layout");
	return { ok: true };
}
