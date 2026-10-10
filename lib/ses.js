import "server-only";
import {
	GetAccountCommand,
	GetEmailIdentityCommand,
	ListEmailIdentitiesCommand,
	SESv2Client,
	SendEmailCommand,
} from "@aws-sdk/client-sesv2";
import { isSendingEnabled } from "./config.js";

// Not AWS_REGION: that one is the Neon Object Storage region (lib/storage-bucket.js).
const REGION = process.env.SES_REGION || "us-east-1";
// The overview and the editor read the account and domains from here; the domains page asks fresh.
const CACHE_TTL_MS = 5 * 60_000;
// Reads only: a send that timed out could still have gone out, and the SDK would retry it.
const READ_TIMEOUT_MS = 5000;
const cache = new Map();
let client;

// Vercel reserves the AWS_* credential names, and locally they hold the Neon Object Storage keys pulled by
// `neon env pull`. Without SES_* keys the SDK's default chain decides, and it reads AWS_* first.
function getCredentials() {
	const { SES_ACCESS_KEY_ID: accessKeyId, SES_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
	return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined;
}

function getClient() {
	client ??= new SESv2Client({ region: REGION, credentials: getCredentials() });
	return client;
}

function read(command) {
	return getClient().send(command, { abortSignal: AbortSignal.timeout(READ_TIMEOUT_MS) });
}

// Callers that arrive while a load is running share it. Errors aren't kept.
async function cached(key, { fresh }, load) {
	const hit = cache.get(key);
	if (!fresh && hit && hit.expiresAt > Date.now()) return hit.promise;
	const entry = { promise: load(), expiresAt: Date.now() + CACHE_TTL_MS };
	cache.set(key, entry);
	const value = await entry.promise;
	if (value?.error && cache.get(key) === entry) cache.delete(key);
	return value;
}

export function getSesAccount({ fresh = false } = {}) {
	return cached("account", { fresh }, loadSesAccount);
}

export function listSesDomains({ fresh = false } = {}) {
	return cached("domains", { fresh }, loadSesDomains);
}

async function loadSesAccount() {
	try {
		const account = await read(new GetAccountCommand({}));
		return {
			productionAccess: Boolean(account.ProductionAccessEnabled),
			reviewStatus: account.Details?.ReviewDetails?.Status || null,
			sendingEnabled: Boolean(account.SendingEnabled),
			enforcementStatus: account.EnforcementStatus,
			max24HourSend: account.SendQuota?.Max24HourSend ?? 0,
			maxSendRate: account.SendQuota?.MaxSendRate ?? 0,
			sentLast24Hours: account.SendQuota?.SentLast24Hours ?? 0,
		};
	} catch (error) {
		return { error: error.message };
	}
}

function dnsRecords(domain, identity) {
	const dkim = (identity.DkimAttributes?.Tokens || []).map((token) => ({
		type: "CNAME",
		name: `${token}._domainkey.${domain}`,
		value: `${token}.dkim.amazonses.com`,
	}));
	const mailFrom = identity.MailFromAttributes?.MailFromDomain;
	const bounce = mailFrom
		? [
				{ type: "MX", name: mailFrom, value: `10 feedback-smtp.${REGION}.amazonses.com` },
				{ type: "TXT", name: mailFrom, value: "v=spf1 include:amazonses.com ~all" },
			]
		: [];
	return [...dkim, ...bounce];
}

async function loadSesDomains() {
	try {
		const { EmailIdentities = [] } = await read(new ListEmailIdentitiesCommand({ PageSize: 100 }));
		const domains = EmailIdentities.filter((identity) => identity.IdentityType === "DOMAIN");
		return await Promise.all(
			domains.map(async ({ IdentityName: domain }) => {
				const identity = await read(new GetEmailIdentityCommand({ EmailIdentity: domain }));
				return {
					domain,
					verified: Boolean(identity.VerifiedForSendingStatus),
					dkimStatus: identity.DkimAttributes?.Status || "NOT_STARTED",
					mailFromDomain: identity.MailFromAttributes?.MailFromDomain || null,
					mailFromStatus: identity.MailFromAttributes?.MailFromDomainStatus || null,
					records: dnsRecords(domain, identity),
				};
			})
		);
	} catch (error) {
		return { error: error.message };
	}
}

export async function sendSesEmail({ from, to, replyTo, subject, html, text, headers = {}, tags = [] }) {
	if (!isSendingEnabled()) throw new Error("Sending is off (SENDING_ENABLED is not true)");

	const result = await getClient().send(
		new SendEmailCommand({
			FromEmailAddress: from,
			Destination: { ToAddresses: [to] },
			ReplyToAddresses: replyTo ? [replyTo] : undefined,
			ConfigurationSetName: process.env.SES_CONFIGURATION_SET || undefined,
			EmailTags: tags.map(({ name, value }) => ({ Name: name, Value: value })),
			Content: {
				Simple: {
					Subject: { Data: subject, Charset: "UTF-8" },
					Body: {
						Html: { Data: html, Charset: "UTF-8" },
						Text: { Data: text, Charset: "UTF-8" },
					},
					Headers: Object.entries(headers).map(([Name, Value]) => ({ Name, Value })),
				},
			},
		})
	);
	return { sesMessageId: result.MessageId };
}
