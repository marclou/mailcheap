import "server-only";
import { LIMITS } from "@/lib/config";
import { connectDb } from "@/lib/db";
import {
	associateTenantResources,
	createConfigurationSet,
	createDomainIdentity,
	createTenant,
	deleteConfigurationSet,
	deleteDomainIdentity,
	deleteTenant,
	dissociateTenantIdentity,
	getDomainIdentity,
	reinstateTenant,
	sendSesEmail,
	sendSesPlatformEmail,
} from "@/lib/ses";
import Account from "@/models/Account";
import Domain from "@/models/Domain";

// SES allows 64 letters, digits, - and _: the account id fits and never changes.
export function getTenantName(accountId) {
	return `mc-${accountId}`;
}

function getTenant(account) {
	return account?.ses?.provisionedAt ? account.ses : null;
}

// One SES tenant per account, with its own configuration set and the account's own domains. Every step is
// safe to repeat, so a failed attempt is finished by the next one. Shared addresses are identities of their own
// (lib/shared-sender.js), added like domains. A domain being added is skipped: its identity doesn't exist yet,
// and addDomain associates it once it does.
async function provisionTenant(accountId, { pendingDomain } = {}) {
	await connectDb();
	const account = await Account.findById(accountId).select({ ses: 1 }).lean();
	if (!account) throw new Error("Account not found");
	if (account.ses?.provisionedAt) return account.ses;

	const name = getTenantName(account._id);
	await createConfigurationSet(name);
	const { tenantArn, sendingStatus } = await createTenant(name, { accountId: account._id });
	const domains = await Domain.find({
		accountId: account._id,
		provider: { $in: ["ses", null] },
		...(pendingDomain && { domain: { $ne: pendingDomain } }),
	})
		.select({ domain: 1 })
		.lean();
	await associateTenantResources(name, { identities: domains.map(({ domain }) => domain), configurationSets: [name] });

	const ses = {
		...account.ses,
		tenantName: name,
		tenantArn,
		configurationSet: name,
		provisionedAt: new Date(),
		tenantStatus: sendingStatus ?? account.ses?.tenantStatus,
	};
	await Account.updateOne({ _id: account._id }, { $set: { ses } });
	return ses;
}

async function ensureTenant(account, { pendingDomain } = {}) {
	return getTenant(account) ?? provisionTenant(account._id, { pendingDomain });
}

// MailCheap's own block is what holds an account on SES; SES pauses tenants itself (lib/tenant-events.js).
async function suspendTenant() {}

// After an admin unblocks an account that SES paused. REINSTATED lets it send while findings stay open.
async function resumeTenant(accountId) {
	await connectDb();
	const account = await Account.findById(accountId).select({ ses: 1, pausedBy: 1 }).lean();
	const isPausedBySes = account?.pausedBy === "ses" || account?.ses?.tenantStatus === "DISABLED";
	if (!account?.ses?.tenantArn || !isPausedBySes) return false;
	await reinstateTenant(account.ses.tenantArn);
	await Account.updateOne({ _id: account._id }, { $set: { "ses.tenantStatus": "REINSTATED", "ses.tenantStatusAt": new Date() } });
	return true;
}

// Easy DKIM, and a custom MAIL FROM so SPF aligns with the domain.
const RETURN_PATH_PREFIX = "bounce";

function getMailFromDomain(domain) {
	return `${RETURN_PATH_PREFIX}.${domain}`;
}

async function addDomain({ account, domain }) {
	const { tenantName, configurationSet } = await ensureTenant(account, { pendingDomain: domain });
	await createDomainIdentity(domain, { configurationSet, mailFromDomain: getMailFromDomain(domain) });
	await associateTenantResources(tenantName, { identities: [domain] });
	return { providerDomainId: null };
}

// Read fresh: SES has no budget on reads that matters here.
function readDomain({ domain }) {
	return getDomainIdentity(domain.domain);
}

async function removeDomain({ account, domain }) {
	if (account.ses?.tenantName) await dissociateTenantIdentity(account.ses.tenantName, domain.domain);
	await deleteDomainIdentity(domain.domain);
}

// SES's rate is one number for every customer and every kind of email (lib/send-rate.js).
function getSendLane() {
	return { name: "ses", rate: LIMITS.sendRatePerSecond };
}

// SES returns tags with every event, so a bounce or complaint always says which account it belongs to.
function getMessageTags(message) {
	const tags = [
		{ name: "message_id", value: String(message._id) },
		{ name: "account_id", value: String(message.accountId) },
		{ name: "kind", value: message.kind },
	];
	if (message.campaignId) tags.push({ name: "campaign_id", value: String(message.campaignId) });
	return tags;
}

async function sendEmail({ tenant, message, email, feedbackId }) {
	const { sesMessageId } = await sendSesEmail({
		...email,
		headers: { ...email.headers, "Feedback-ID": feedbackId },
		tags: getMessageTags(message),
		tenantName: tenant.tenantName,
		configurationSet: tenant.configurationSet,
	});
	return { providerMessageId: sesMessageId };
}

function describeTenant(account) {
	const tenant = getTenant(account);
	return tenant ? { id: tenant.tenantName, status: tenant.tenantStatus ?? null, detail: tenant.lastFinding ?? null } : null;
}

// An account's purge, once its identities are gone: the tenant and its configuration set.
async function removeTenant(account) {
	const { tenantName, configurationSet } = account.ses ?? {};
	if (tenantName) await deleteTenant(tenantName);
	if (configurationSet) await deleteConfigurationSet(configurationSet);
}

function isConfigured() {
	return Boolean(process.env.SES_ACCESS_KEY_ID && process.env.SES_SECRET_ACCESS_KEY);
}

export const sesProvider = Object.freeze({
	id: "ses",
	name: "Amazon SES",
	returnPathPrefix: RETURN_PATH_PREFIX,
	isConfigured,
	sendPlatformEmail: sendSesPlatformEmail,
	getTenant,
	provisionTenant,
	ensureTenant,
	suspendTenant,
	resumeTenant,
	describeTenant,
	removeTenant,
	getMailFromDomain,
	addDomain,
	readDomain,
	removeDomain,
	getSendLane,
	sendEmail,
});
