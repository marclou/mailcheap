import "server-only";
import { getEmailProviderId } from "@/lib/config";
import { postshibaProvider } from "@/lib/email-provider/postshiba";
import { sendhqProvider } from "@/lib/email-provider/sendhq";
import { sesProvider } from "@/lib/email-provider/ses";

// The one switch between providers. Each adapter has the same operations: tenants (getTenant, provisionTenant,
// ensureTenant, suspendTenant, resumeTenant, describeTenant, removeTenant), domains (getMailFromDomain, addDomain,
// readDomain, removeDomain), sending (getSendLane, sendEmail), MailCheap's own emails on a self-hosted server without
// Resend (sendPlatformEmail) and isConfigured. Errors carry an outcome from ./outcomes.js.
// returnPathPrefix: the subdomain bounces come back to.
function getProviders() {
	return { postshiba: postshibaProvider, ses: sesProvider, sendhq: sendhqProvider };
}

export function getProvider(id) {
	return getProviders()[id] ?? null;
}

export function getEmailProvider() {
	const provider = getProvider(getEmailProviderId());
	if (!provider) throw new Error(`EMAIL_PROVIDER must be postshiba, ses or sendhq, not "${process.env.EMAIL_PROVIDER}"`);
	return provider;
}

// Its keys are in the environment. Before that, nothing can be set up there, and that isn't an error.
export function isEmailProviderConfigured() {
	return Boolean(getProvider(getEmailProviderId())?.isConfigured());
}
