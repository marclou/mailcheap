"use server";

import { redirect } from "next/navigation";
import { runAccountAction, toBillingError } from "@/lib/actions/dashboard";

// The billing page says it itself when the input was wrong or billing is off on this server.
const BILLING_PAGE_CODES = new Set(["validation_failed", "billing_off"]);

// Without a paid plan: Stripe Checkout. With one: Stripe's page to confirm the change.
export async function choosePlan(formData) {
	const interval = formData.get("interval") === "year" ? "year" : "month";
	const { output, failure } = await runAccountAction("change_plan", { plan: String(formData.get("plan") ?? ""), interval });
	if (BILLING_PAGE_CODES.has(failure?.code)) redirect("/billing");
	redirect(failure ? `/billing?interval=${interval}&error=${toBillingError(failure)}` : output.url);
}

export async function openBillingPortal() {
	const { output, failure } = await runAccountAction("open_billing_portal", {});
	if (failure) redirect(failure.code === "conflict" || BILLING_PAGE_CODES.has(failure.code) ? "/billing" : `/billing?error=${toBillingError(failure)}`);
	redirect(output.url);
}
