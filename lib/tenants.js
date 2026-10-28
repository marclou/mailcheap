import "server-only";
import { sendAlert } from "@/lib/alerts";
import { getEmailProvider, getProvider } from "@/lib/email-provider";

// One tenant per account at the email provider (lib/email-provider): its own domains, suppressions and
// pause switch. Created when a plan starts; the first send or domain tries again if that failed.
export function getTenant(account) {
	return getEmailProvider().getTenant(account);
}

export function provisionTenant(accountId) {
	return getEmailProvider().provisionTenant(accountId);
}

// Two Stripe events for one checkout start the plan at the same moment: the run that loses the race fails at the
// provider while the other one succeeds, so a failure is tried once more before anyone is alerted.
const RETRY_AFTER_MS = 2_000;

async function provisionTenantWithRetry(provider, accountId) {
	try {
		return await provider.provisionTenant(accountId);
	} catch {
		await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
		return provider.provisionTenant(accountId);
	}
}

// When a plan starts. A failure doesn't stop the checkout: the first send tries again (ensureTenant).
export async function provisionTenantQuietly(accountId) {
	const provider = getEmailProvider();
	try {
		return await provisionTenantWithRetry(provider, accountId);
	} catch (error) {
		console.error(`[tenants] Could not set up ${provider.name} for account ${accountId}: ${error.message}`);
		await sendAlert({
			accountId: null,
			key: `tenant-failed:${accountId}`,
			title: `${provider.name} tenant not created`,
			detail: `Account ${accountId}: ${error.message}. The account's first send will try again.`,
			path: "/admin",
		});
		return null;
	}
}

export function ensureTenant(account) {
	return getEmailProvider().ensureTenant(account);
}

// A blocked or deleted account's tenant stops at the provider too, where the provider supports it. MailCheap's own
// block already stops its sends, so a provider that doesn't answer is reported, not retried.
export async function suspendTenantQuietly(accountId) {
	const provider = getEmailProvider();
	try {
		await provider.suspendTenant(accountId);
	} catch (error) {
		console.error(`[tenants] ${provider.name} didn't suspend account ${accountId}: ${error.message}`);
		await sendAlert({
			accountId: null,
			key: `tenant-suspend-failed:${accountId}`,
			title: `${provider.name} tenant not suspended`,
			detail: `Account ${accountId} is stopped in MailCheap, but ${provider.name} didn't suspend its tenant: ${error.message}`,
			action: `MailCheap doesn't try again: suspend it at ${provider.name} by hand.`,
			path: "/admin",
		});
	}
}

// An admin unblocking an account: the provider lifts its own pause on the tenant, or throws why it can't.
export function resumeTenant(accountId) {
	return getEmailProvider().resumeTenant(accountId);
}

// An account restored before its purge. A provider that refuses (a hold of its abuse team) is reported: the
// account stays stopped there until an admin sorts it out.
export async function resumeTenantQuietly(accountId) {
	const provider = getEmailProvider();
	try {
		await provider.resumeTenant(accountId);
	} catch (error) {
		console.error(`[tenants] ${provider.name} didn't resume account ${accountId}: ${error.message}`);
		await sendAlert({
			accountId: null,
			key: `tenant-resume-failed:${accountId}`,
			title: `${provider.name} tenant not resumed`,
			detail: `Account ${accountId} was restored after its owner deleted it, but ${provider.name} didn't resume its tenant: ${error.message}`,
			action: `It can't send until its tenant is resumed at ${provider.name}.`,
			path: "/admin",
		});
	}
}

// A contact who unsubscribed is back (signed up again, or resubscribed with their consent): a provider that keeps its
// own unsubscribe lifts it, or it keeps refusing their email. MailCheap's contact status decides who gets email, so a
// failure is logged and doesn't stop the signup.
export async function resubscribeContactQuietly({ accountId, email }) {
	let provider;
	try {
		provider = getEmailProvider();
		if (!provider.resubscribeContact || !provider.isConfigured()) return;
		await provider.resubscribeContact({ accountId, email });
	} catch (error) {
		console.error(`[tenants] ${provider?.name ?? "The email provider"} may still refuse a resubscribed contact of account ${accountId}: ${error.message}`);
	}
}

// An account's purge, once its domains are gone: its tenant at every provider it has one at. A provider that
// isn't the active one may not be set up any longer, so only the active one's failure stops the purge.
export async function removeTenants(account) {
	const active = getEmailProvider();
	for (const provider of [getProvider("postshiba"), getProvider("ses"), getProvider("groundmail")]) {
		try {
			await provider.removeTenant(account);
		} catch (error) {
			if (provider === active) throw error;
			console.error(`[tenants] ${provider.name} still has account ${account._id}'s tenant: ${error.message}`);
		}
	}
}
