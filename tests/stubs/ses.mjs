import { findDnsRecord } from "./dns-broker.mjs";

// An in-memory SES: emails, tenants, identities and associations are kept here instead of going to AWS.
export const sent = [];
// MailCheap's own emails, sent outside every tenant (a self-hosted server without Resend).
export const platformSent = [];
export const calls = [];
export const state = {
	configurationSets: new Set(),
	tenants: new Map(),
	identities: new Map(),
	associations: new Map(),
	reinstated: [],
	failNext: null,
};

function call(name, args) {
	calls.push({ name, args });
	if (state.failNext?.name === name) {
		const { error, times = 1 } = state.failNext;
		state.failNext = times > 1 ? { ...state.failNext, times: times - 1 } : null;
		throw error;
	}
}

// Marks a domain as SES would once its DNS records are in.
export function verifyIdentity(domain) {
	const identity = state.identities.get(domain);
	Object.assign(identity, { verified: true, dkimStatus: "SUCCESS", mailFromStatus: "SUCCESS" });
}

export function getIdentityArn(identity) {
	return `arn:aws:ses:us-east-1:111122223333:identity/${identity}`;
}

export async function sendSesEmail(email) {
	if (process.env.SENDING_ENABLED !== "true") throw new Error("Sending is off (SENDING_ENABLED is not true)");
	call("sendSesEmail", email);
	const { tenantName, configurationSet, from } = email;
	if (!tenantName || !configurationSet) throw new Error("Every email needs the account's SES tenant and configuration set");
	const associated = state.associations.get(tenantName) ?? new Set();
	const fromDomain = from.match(/@([^>\s]+)>?$/)?.[1];
	if (!associated.has(`identity/${fromDomain}`) || !associated.has(`configuration-set/${configurationSet}`)) {
		throw Object.assign(new Error(`${fromDomain} or ${configurationSet} is not associated with ${tenantName}`), { name: "NotFoundException" });
	}
	sent.push(email);
	return { sesMessageId: `ses-${sent.length}-${Date.now()}` };
}

export async function sendSesPlatformEmail(email) {
	call("sendSesPlatformEmail", email);
	platformSent.push(email);
	return { sesMessageId: `ses-platform-${platformSent.length}` };
}

export async function getSesAccount() {
	return { productionAccess: true, sendingEnabled: true, max24HourSend: 50_000, maxSendRate: 14, sentLast24Hours: 0 };
}

export async function createConfigurationSet(name) {
	call("createConfigurationSet", name);
	state.configurationSets.add(name);
}

export async function createTenant(name, { accountId }) {
	call("createTenant", { name, accountId });
	if (!state.tenants.has(name)) state.tenants.set(name, { accountId, policy: "standard", suppression: "TENANT" });
	return { tenantArn: `arn:aws:ses:us-east-1:111122223333:tenant/${name}/tn-${name}`, sendingStatus: "ENABLED" };
}

export async function associateTenantResources(tenantName, { identities = [], configurationSets = [] }) {
	call("associateTenantResources", { tenantName, identities, configurationSets });
	// Like SES: an identity that was never created can't join a tenant.
	const missing = identities.find((identity) => !state.identities.has(identity));
	if (missing) throw Object.assign(new Error(`Identity <${missing}> does not exist`), { name: "NotFoundException" });
	const set = state.associations.get(tenantName) ?? new Set();
	for (const identity of identities) set.add(`identity/${identity}`);
	for (const name of configurationSets) set.add(`configuration-set/${name}`);
	state.associations.set(tenantName, set);
}

export async function dissociateTenantIdentity(tenantName, identity) {
	call("dissociateTenantIdentity", { tenantName, identity });
	state.associations.get(tenantName)?.delete(`identity/${identity}`);
}

// Like SES, deleting a tenant drops its associations, never the identities themselves.
export async function deleteTenant(name) {
	call("deleteTenant", name);
	state.tenants.delete(name);
	state.associations.delete(name);
}

export async function deleteConfigurationSet(name) {
	call("deleteConfigurationSet", name);
	state.configurationSets.delete(name);
}

export async function reinstateTenant(tenantArn) {
	call("reinstateTenant", tenantArn);
	state.reinstated.push(tenantArn);
}

export async function createDomainIdentity(domain, { configurationSet, mailFromDomain }) {
	call("createDomainIdentity", { domain, configurationSet, mailFromDomain });
	if (!state.identities.has(domain)) {
		state.identities.set(domain, { verified: false, dkimStatus: "PENDING", mailFromStatus: "PENDING", mailFromDomain, keyLength: "RSA_2048_BIT" });
	}
}

export async function deleteDomainIdentity(domain) {
	call("deleteDomainIdentity", domain);
	state.identities.delete(domain);
}

const tokens = ["tok1", "tok2", "tok3"];

// Records MailCheap published itself, on a Vercel-hosted zone: SES finds them like it would in DNS.
function isPublished(domain) {
	return tokens.every((token) => findDnsRecord(`${token}._domainkey.${domain}`, "CNAME")?.value === `${token}.dkim.amazonses.com`);
}

export async function getDomainIdentity(domain) {
	call("getDomainIdentity", domain);
	const identity = state.identities.get(domain);
	if (!identity) return { missing: true };
	if (!identity.verified && isPublished(domain)) verifyIdentity(domain);
	return {
		verified: identity.verified,
		dkimStatus: identity.dkimStatus,
		mailFromStatus: identity.mailFromStatus,
		records: [
			...tokens.map((token) => ({ purpose: "dkim", type: "CNAME", name: `${token}._domainkey.${domain}`, value: `${token}.dkim.amazonses.com` })),
			{ purpose: "mail-from", type: "MX", name: identity.mailFromDomain, value: "10 feedback-smtp.us-east-1.amazonses.com" },
			{ purpose: "mail-from", type: "TXT", name: identity.mailFromDomain, value: "v=spf1 include:amazonses.com ~all" },
		],
	};
}
