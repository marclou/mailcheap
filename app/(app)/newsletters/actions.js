"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runDashboardAction, toFormError } from "@/lib/actions/dashboard";
import { SETTINGS_PATH, readSettingsForm } from "@/lib/newsletter-sections";
import { getSelectedNewsletter, saveSelectedNewsletter, switchNewsletter } from "@/lib/selected-newsletter";

function readText(formData, key) {
	return String(formData.get(key) ?? "").trim();
}

// The slug field asks as its value settles: available, or why not.
export async function checkSlug(slug, newsletterId) {
	const { output, failure } = await runDashboardAction("check_newsletter_slug", {
		slug: String(slug ?? ""),
		...(newsletterId && { id: String(newsletterId) }),
	});
	return failure ? toFormError(failure) : output;
}

export async function sendWelcomeTest(newsletterId) {
	const { failure } = await runDashboardAction("send_welcome_test_email", { id: String(newsletterId ?? "") });
	return failure ? toFormError(failure) : { ok: true };
}

// A section's page saves only its section; the overview and the other pages show what it changed.
export async function saveNewsletter(_state, formData) {
	const id = readText(formData, "id");
	const settings = readSettingsForm(formData);
	const { output, failure } = id
		? await runDashboardAction("update_newsletter", { id, ...settings })
		: await runDashboardAction("create_newsletter", settings);
	if (failure) return toFormError(failure);
	revalidatePath(SETTINGS_PATH, "layout");
	if (!id) redirect(`/newsletters/${output.id}`);
	return { ok: true, savedAt: Date.now() };
}

// The newsletter menu. Which newsletter the dashboard shows is its own state, a cookie: no action of the API runs.
export async function selectNewsletter(id, pathname) {
	return switchNewsletter(id, pathname);
}

// Add a newsletter: a name and a description. The sender's name and postal address are the newsletter's that was
// open, so it can send once its settings look right; without a shared domain, the form also asks for its address.
export async function createNewsletter(_state, formData) {
	const name = readText(formData, "name");
	if (!name) return { error: "Name your newsletter" };
	const { selected } = await getSelectedNewsletter();
	const fromEmail = readText(formData, "fromEmail");
	const { output, failure } = await runDashboardAction("create_newsletter", {
		name,
		description: readText(formData, "description"),
		...(fromEmail && { fromEmail }),
		...(selected?.fromName && { fromName: selected.fromName }),
		...(selected?.postalAddress && { postalAddress: selected.postalAddress }),
	});
	if (failure) return toFormError(failure);
	await saveSelectedNewsletter(output.id);
	redirect("/newsletters");
}

// Form for your site (FormEmbed): its switch, text, layout and sites, all sent each time.
export async function saveSignupForm(newsletterId, signupForm) {
	const { output, failure } = await runDashboardAction("update_newsletter", { id: String(newsletterId ?? ""), signupForm });
	if (failure) return toFormError(failure);
	revalidatePath(SETTINGS_PATH, "layout");
	return { ok: true, signupForm: output.signupForm };
}

// Design (FormTheme): a preset alone applies it as it comes; the customizer sends a theme's full values.
export async function saveTheme(newsletterId, theme) {
	const { output, failure } = await runDashboardAction("update_newsletter", { id: String(newsletterId ?? ""), theme });
	if (failure) return toFormError(failure);
	revalidatePath("/newsletters", "layout");
	return { ok: true, theme: output.theme };
}
