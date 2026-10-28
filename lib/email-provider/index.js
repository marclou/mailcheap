import "server-only";
import { getEmailProviderId } from "@/lib/config";
import { groundmailProvider } from "@/lib/email-provider/groundmail";
import { postshibaProvider } from "@/lib/email-provider/postshiba";
import { sesProvider } from "@/lib/email-provider/ses";

// The one switch between providers. Each adapter has the same operations: tenants (getTenant, provisionTenant,
// ensureTenant, suspendTenant, resumeTenant, describeTenant, removeTenant), domains (getMailFromDomain, addDomain,
// readDomain, removeDomain), sending (getSendLane, sendEmail), MailCheap's own emails on a self-hosted server without
// Resend (sendPlatformEmail) and isConfigured. Errors carry an outcome from ./outcomes.js. Optional: resubscribeContact,
// for a provider that keeps its own unsubscribes, which a contact coming back lifts.
// returnPathPrefix: the subdomain bounces come back to.
function getProviders() {
	return { groundmail: groundmailProvider, postshiba: postshibaProvider, ses: sesProvider };
}

export function getProvider(id) {
	return getProviders()[id] ?? null;
}

export function getEmailProvider() {
	const provider = getProvider(getEmailProviderId());
	if (!provider) throw new Error(`EMAIL_PROVIDER must be postshiba, ses or groundmail, not "${process.env.EMAIL_PROVIDER}"`);
	return provider;
}

// Its keys are in the environment. Before that, nothing can be set up there, and that isn't an error.
export function isEmailProviderConfigured() {
	return Boolean(getProvider(getEmailProviderId())?.isConfigured());
}
