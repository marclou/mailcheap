import "server-only";
import { EMAIL_PROVIDERS, getEmailProvider } from "./config.js";
import { getResendAccount, listResendDomains, sendResendEmail } from "./resend.js";
import { getSesAccount, listSesDomains, sendSesEmail } from "./ses.js";

// One door to whichever provider sends: EMAIL_PROVIDER picks Amazon SES or Resend (lib/config.js).
export function getProviderInfo() {
	const provider = getEmailProvider();
	return { provider, ...EMAIL_PROVIDERS[provider] };
}

// Returns { providerMessageId }: SES's MessageId or Resend's email id, which their events point back to.
export async function sendEmail(email) {
	if (getEmailProvider() === "resend") return sendResendEmail(email);
	const { sesMessageId } = await sendSesEmail(email);
	return { providerMessageId: sesMessageId };
}

// Each domain as { domain, verified, dkimStatus, mailFromDomain, mailFromStatus, records }, or { error }.
export function listSendingDomains(options) {
	return getEmailProvider() === "resend" ? listResendDomains(options) : listSesDomains(options);
}

export async function getSendingAccount(options) {
	if (getEmailProvider() === "resend") return getResendAccount(options);
	const account = await getSesAccount(options);
	return account.error ? account : { provider: "ses", ...account };
}
