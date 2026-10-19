import "server-only";
import { LIMITS, isSendingEnabled } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { SEND_OUTCOMES, providerError } from "@/lib/email-provider/outcomes";
import { buildEmail, getSendError, getTags, getTenantExternalId, readVerifyChecks, toDomainStatus } from "@/lib/email-provider/groundmail-rules";
import * as groundmail from "@/lib/groundmail";
import { getEmailDomain } from "@/lib/sender-rules";
import { normalizeAddress } from "@/lib/validation";
import Account from "@/models/Account";
import Domain from "@/models/Domain";

const HOLD = "held";
// A Groundmail account without tenants answers tenants_not_enabled. Every MailCheap account then sends as the
// Groundmail account itself, sharing its domains' owner, suppression list and pause switch, and tenants are asked
// for again after a while.
const TENANTS_RECHECK_MS = 10 * 60_000;
const NO_TENANT = Object.freeze({ tenantId: null, externalId: null });
let tenantsOffUntil = 0;

function conflict(message) {
	return Object.assign(new Error(message), { code: "conflict" });
}

function getTenant(account) {
	return account?.groundmail?.provisionedAt ? account.groundmail : null;
}

function noteTenantsOff() {
	if (Date.now() >= tenantsOffUntil) {
		console.warn("[groundmail] The Groundmail account has no tenants (tenants_not_enabled): every account sends as the Groundmail account, with one suppression list and no pause switch of its own");
	}
	tenantsOffUntil = Date.now() + TENANTS_RECHECK_MS;
}

// An external id Groundmail already has is a tenant an earlier attempt created.
async function findOrCreateTenant(externalId) {
	try {
		return await groundmail.createTenant({ externalId, name: externalId });
	} catch (error) {
		if (error.status !== 409) throw error;
		return groundmail.getTenant(externalId);
	}
}

// Domains added while the Groundmail account had no tenants are the account's: they move into the tenant. One another
// tenant has stays there.
async function assignDomains(accountId, externalId) {
	const domains = await Domain.find({ accountId, provider: "groundmail", providerDomainId: { $type: "string" } }).select({ domain: 1 }).lean();
	for (const { domain } of domains) {
		try {
			await groundmail.assignTenantDomain(externalId, domain);
		} catch (error) {
			if (error.status !== 409 && error.status !== 404) throw error;
			console.warn(`[groundmail] ${domain} stays out of ${externalId}: ${error.message}`);
		}
	}
}

// One tenant per account, with its own domains, suppression list, sending ramp and pause switch. Safe to repeat.
async function provisionTenant(accountId) {
	await connectDb();
	const account = await Account.findById(accountId).select({ groundmail: 1, status: 1 }).lean();
	if (!account) throw new Error("Account not found");
	if (account.groundmail?.provisionedAt) return account.groundmail;

	const externalId = getTenantExternalId(account._id);
	let tenant;
	try {
		tenant = await findOrCreateTenant(externalId);
	} catch (error) {
		if (error.providerCode !== "tenants_not_enabled") throw error;
		noteTenantsOff();
		return NO_TENANT;
	}
	tenantsOffUntil = 0;
	await assignDomains(account._id, externalId);
	const state = {
		tenantId: tenant.id,
		externalId,
		tenantStatus: tenant.status === "paused" ? "paused" : "active",
		tenantStatusAt: new Date(),
		provisionedAt: new Date(),
	};
	await Account.updateOne({ _id: account._id }, { $set: { groundmail: state } });
	// Blocked before its tenant existed: the tenant starts paused too.
	if (account.status === "paused" && state.tenantStatus === "active") await suspendTenant(account._id);
	return state;
}

// Before a send or a new domain. A plan starting always asks Groundmail (provisionTenant).
async function ensureTenant(account) {
	if (getTenant(account)) return getTenant(account);
	return Date.now() < tenantsOffUntil ? NO_TENANT : provisionTenant(account._id);
}

async function setTenantStatus(accountId, status) {
	await Account.updateOne(
		// A hold stays until Groundmail lifts it: pausing on top of it doesn't hide it.
		{ _id: accountId, ...(status === "paused" && { "groundmail.tenantStatus": { $ne: HOLD } }) },
		{ $set: { "groundmail.tenantStatus": status, "groundmail.tenantStatusAt": new Date() } }
	);
}

async function findExternalId(accountId) {
	await connectDb();
	const account = await Account.findById(accountId).select({ "groundmail.externalId": 1 }).lean();
	return account?.groundmail?.externalId ?? null;
}

// With the account's block: nothing the tenant sends goes out, welcome and confirmation emails included. Without a
// tenant there's nothing to pause at Groundmail, and MailCheap's own block stops the account's sends.
async function suspendTenant(accountId) {
	const externalId = await findExternalId(accountId);
	if (!externalId) {
		console.info(`[groundmail] Account ${accountId} has no tenant to pause: its block in MailCheap stops its sends`);
		return;
	}
	await groundmail.setTenantStatus(externalId, { status: "paused", reason: "Blocked in MailCheap" });
	await setTenantStatus(accountId, "paused");
}

// Groundmail refuses while it paused the tenant itself (its pause_source is automated or admin); the account stays
// blocked with that reason.
async function resumeTenant(accountId) {
	const externalId = await findExternalId(accountId);
	if (!externalId) return false;
	try {
		await groundmail.setTenantStatus(externalId, { status: "active" });
	} catch (error) {
		const source = error.providerCode === "forbidden" ? error.details?.pause_source : null;
		if (!source) throw error;
		await setTenantStatus(accountId, HOLD);
		throw providerError(SEND_OUTCOMES.tenantPaused, `Groundmail paused this tenant (${source}): ask Groundmail's support to resume it first`, { hold: HOLD });
	}
	await setTenantStatus(accountId, "active");
	return true;
}

function describeTenant(account) {
	const state = getTenant(account);
	return state?.externalId ? { id: state.externalId, status: state.tenantStatus ?? null, detail: null } : null;
}

// An account's purge, once its domains are gone: the tenant and its suppression list.
async function removeTenant(account) {
	const externalId = account.groundmail?.externalId;
	if (externalId) await groundmail.deleteTenant(externalId);
}

// Groundmail's return path, at rp.<domain> once its CNAME is in.
const RETURN_PATH_PREFIX = "rp";

function getMailFromDomain(domain) {
	return `${RETURN_PATH_PREFIX}.${domain}`;
}

// A domain belongs to one tenant at Groundmail; a name it already has is one an earlier attempt created, which moves
// into this tenant unless another one has it.
async function findOrCreateDomain({ name, tenant }) {
	try {
		return await groundmail.createDomain({ name, tenant });
	} catch (error) {
		if (error.status !== 409) throw error;
		const found = await groundmail.getDomain(name).catch((readError) => {
			if (readError.status === 404) return null;
			throw readError;
		});
		if (!found) throw conflict(`${name} is set up in another Groundmail account`);
		if (tenant) {
			await groundmail.assignTenantDomain(tenant, name).catch((assignError) => {
				throw assignError.status === 409 ? conflict(`${name} is set up at Groundmail for another tenant`) : assignError;
			});
		}
		return found;
	}
}

async function addDomain({ account, domain }) {
	const { externalId } = await ensureTenant(account);
	const created = await findOrCreateDomain({ name: domain, tenant: externalId });
	return { providerDomainId: created.domain.id, status: toDomainStatus(created) };
}

// Groundmail looks at DNS when it's asked to, not on its own, so a domain still being set up is verified on every
// read: lib/domains.js and lib/shared-sender.js read one once a minute at most. A 400 says what's still missing.
async function verify(domainId, found) {
	try {
		await groundmail.verifyDomain(domainId);
	} catch (error) {
		if (error.status !== 400) throw error;
		const records = error.body?.records ?? found.records;
		return toDomainStatus({ domain: found.domain, records }, { checks: readVerifyChecks(error.body), lastError: error.detail || null });
	}
	return toDomainStatus({ domain: { ...found.domain, status: "verified" }, records: found.records });
}

async function readDomain({ domain, verify: isCheck = false }) {
	if (!domain.providerDomainId) return { missing: true };
	try {
		const found = await groundmail.getDomain(domain.providerDomainId);
		if (found.domain?.status === "verified" && !isCheck) return toDomainStatus(found);
		return await verify(domain.providerDomainId, found);
	} catch (error) {
		if (error.status === 404) return { missing: true };
		return { error: error.message };
	}
}

function removeDomain({ domain }) {
	return domain.providerDomainId ? groundmail.deleteDomain(domain.providerDomainId) : null;
}

// One lane for every kind of email: SEND_RATE_PER_SECOND, under Groundmail's request rate.
function getSendLane() {
	return { name: "groundmail", rate: LIMITS.sendRatePerSecond };
}

// Idempotency-Key = the message id: a retry of the same email never sends it twice. Groundmail keeps MailCheap's
// Feedback-ID as it is. A hold seen on a send is kept on the account, where the block that follows
// (lib/tenant-events.js) leaves it.
async function sendEmail({ tenant, message, email: content, feedbackId }) {
	if (!isSendingEnabled()) throw new Error("Sending is off (SENDING_ENABLED is not true)");
	const email = feedbackId ? { ...content, headers: { ...content.headers, "Feedback-ID": feedbackId } } : content;
	let result;
	try {
		result = await groundmail.sendEmail(buildEmail({ email, category: "newsletter", tags: getTags(message), tenant: tenant?.externalId }), {
			idempotencyKey: String(message._id),
		});
	} catch (error) {
		const failure = getSendError(error);
		if (failure.hold) await setTenantStatus(message.accountId, HOLD);
		throw failure;
	}
	// Groundmail's events name the email by this id.
	return { providerMessageId: result?.id ?? null };
}

function isUnverifiedFrom(error) {
	return error.providerCode === "forbidden" && /not verified/i.test(error.detail ?? "");
}

// MailCheap's own emails on a self-hosted server without Resend: transactional mail of the Groundmail account itself,
// in no tenant, so EMAIL_FROM's domain is verified there apart from any newsletter's. The domain is added the first
// time; until Groundmail verifies it, the error says what DNS needs, and each email checks it again.
async function sendPlatformEmail(email) {
	const send = () => groundmail.sendEmail(buildEmail({ email, category: "transactional", tags: [{ name: "kind", value: "platform" }] }), {});
	try {
		return await send();
	} catch (error) {
		if (!isUnverifiedFrom(error)) throw error;
	}
	const name = getEmailDomain(normalizeAddress(email.from));
	const found = await findOrCreateDomain({ name, tenant: null });
	const { verified, records } = await verify(found.domain.id, found);
	if (!verified) {
		const needed = records.map(({ type, name: host, value }) => `${type} ${host} ${value}`).join(" and ");
		throw new Error(`Groundmail can't send from ${name} yet: add ${needed} to its DNS. The next email checks it again.`);
	}
	return send();
}

function isConfigured() {
	try {
		groundmail.getGroundmailConfig();
		return true;
	} catch {
		return false;
	}
}

export const groundmailProvider = Object.freeze({
	id: "groundmail",
	name: "Groundmail",
	returnPathPrefix: RETURN_PATH_PREFIX,
	isConfigured,
	sendPlatformEmail,
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
