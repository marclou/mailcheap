"use server";

import { revalidatePath } from "next/cache";
import { runDashboardAction, toFormError } from "@/lib/actions/dashboard";
import { SETTINGS_PATH } from "@/lib/newsletter-sections";

function readText(formData, key) {
	return String(formData.get(key) ?? "").trim();
}

// Invite: a name, an address and a role, from the dialog's form.
export async function inviteTeamMember(_state, formData) {
	const { output, failure } = await runDashboardAction("invite_team_member", {
		id: readText(formData, "newsletterId"),
		name: readText(formData, "name"),
		email: readText(formData, "email"),
		role: readText(formData, "role"),
	});
	if (failure) return toFormError(failure);
	revalidatePath(SETTINGS_PATH, "layout");
	return { ok: true, email: output.email };
}

// Send again: a new link to the same address, with its name and role.
export async function resendInvitation(newsletterId, { name, email, role } = {}) {
	const { failure } = await runDashboardAction("invite_team_member", {
		id: String(newsletterId ?? ""),
		name: String(name ?? ""),
		email: String(email ?? ""),
		role: String(role ?? ""),
	});
	if (failure) return toFormError(failure);
	revalidatePath(SETTINGS_PATH, "layout");
	return { ok: true };
}

export async function changeTeamRole(newsletterId, memberId, role) {
	const { failure } = await runDashboardAction("update_team_member", { id: String(newsletterId ?? ""), memberId: String(memberId ?? ""), role: String(role ?? "") });
	if (failure) return toFormError(failure);
	revalidatePath(SETTINGS_PATH, "layout");
	return { ok: true };
}

export async function removeTeamMember(newsletterId, memberId) {
	const { failure } = await runDashboardAction("remove_team_member", { id: String(newsletterId ?? ""), memberId: String(memberId ?? "") });
	if (failure) return toFormError(failure);
	revalidatePath(SETTINGS_PATH, "layout");
	return { ok: true };
}
