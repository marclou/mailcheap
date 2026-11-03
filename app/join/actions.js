"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { notifyActivity } from "@/lib/alerts";
import { getAuth, requireAccount } from "@/lib/auth";
import { saveSelectedNewsletter } from "@/lib/selected-newsletter";
import { acceptInvitation } from "@/lib/team";
import { getJoinPath } from "@/lib/team-rules";

// Join: the invitation's newsletter opens in the dashboard, with what the role allows.
export async function joinTeam(_state, formData) {
	const { user } = await requireAccount();
	const result = await acceptInvitation({ token: String(formData.get("token") ?? ""), user });
	if (result.error) return { error: result.error };
	await notifyActivity(["Joined a team", user.email], { withUserAgent: true });
	await saveSelectedNewsletter(result.newsletterId);
	redirect("/");
}

// Signs out and back to sign-in with the same invitation, to sign in with the address it went to.
export async function switchAccount(formData) {
	const token = String(formData.get("token") ?? "");
	await (await getAuth()).api.signOut({ headers: await headers() });
	redirect(/^[A-Za-z0-9_-]{43}$/.test(token) ? `/signin?next=${encodeURIComponent(getJoinPath(token))}` : "/signin");
}
