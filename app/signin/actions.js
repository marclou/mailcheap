"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { findUserByEmail } from "@/lib/accounts";
import { notifyActivity } from "@/lib/alerts";
import { SIGNIN_NOT_ALLOWED_MESSAGE, SIGNUP_ERRORS, getAuth, getAuthCallContext, getSignupError, isGoogleEnabled, sendSigninCodeEmail } from "@/lib/auth";
import { isBotRequest } from "@/lib/bot-check";
import { isCloud, isEmailAllowed } from "@/lib/config";
import { getDomainLists } from "@/lib/domain-lists";
import { classifyDomain } from "@/lib/domain-reputation";
import { getCanonicalEmail } from "@/lib/email-aliases";
import { getEmailSuggestion } from "@/lib/email-typos";
import { findDomainsWithoutMail } from "@/lib/mail-domains";
import { isExpiredOAuthQuery, readOAuthQueryField } from "@/lib/oauth-rules";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { rememberNewsletter } from "@/lib/selected-newsletter";
import { acceptInvitation, findInvitation, isSameInbox } from "@/lib/team";
import { normalizeEmail, toSafeNextPath } from "@/lib/validation";

const CODES_PER_IP = { name: "signin-code-ip", limit: 10, window: "15 m" };
const CODES_PER_EMAIL = { name: "signin-code-email", limit: 5, window: "15 m" };
// A script that waits out the limits above still can't mail one inbox all day.
const DAILY_CODES_PER_IP = { name: "signin-code-ip-day", limit: 30, window: "1 d" };
const DAILY_CODES_PER_EMAIL = { name: "signin-code-email-day", limit: 10, window: "1 d" };
// Each code also dies after 3 wrong tries (Better Auth's emailOTP).
const CHECKS_PER_IP = { name: "signin-check-ip", limit: 30, window: "15 m" };
const CODE_PATTERN = /^\d{6}$/;
const CODE_FAILED_MESSAGE = "Couldn't send the code. Try again in a minute.";
const OAUTH_EXPIRED_MESSAGE = "This sign-in link expired. Go back to the app and connect MailCheap again.";

// The allowlist and the address's checks come after the rate limits, so the form can't be used to test addresses
// quickly.
export async function sendSigninCode(_state, formData) {
	const email = normalizeEmail(formData.get("email"));
	if (!email) return { error: "Enter a valid email" };
	// The same answer as a failed send, so a script learns nothing from it.
	if (await isBotRequest("sign-in code request")) return { error: CODE_FAILED_MESSAGE };

	const ip = getClientIp(await headers());
	// Counted per inbox: every dot and +tag of a Gmail address reaches the same one (lib/email-aliases.js).
	const inbox = getCanonicalEmail(email) ?? email;
	if ((await isRateLimited({ ...CODES_PER_IP, key: ip })) || (await isRateLimited({ ...CODES_PER_EMAIL, key: inbox }))) {
		return { error: "Too many codes. Try again in 15 minutes." };
	}
	if ((await isRateLimited({ ...DAILY_CODES_PER_IP, key: ip })) || (await isRateLimited({ ...DAILY_CODES_PER_EMAIL, key: inbox }))) {
		return { error: "Too many codes today. Try again tomorrow." };
	}
	if (!isEmailAllowed(email)) return { error: SIGNIN_NOT_ALLOWED_MESSAGE };
	// From an invitation's link, only the address it went to joins: the form keeps it.
	const invitation = await findInvitation(String(formData.get("invitation") ?? ""));
	if (invitation && !isSameInbox(email, invitation.member.email)) return { error: "Sign in with the address your invitation went to" };
	const problem = isCloud() && (await getAddressProblem(email));
	if (problem) return problem;
	try {
		await sendSigninCodeEmail(email);
	} catch (error) {
		console.error("[signin] Could not send a code:", error.message);
		return { error: CODE_FAILED_MESSAGE };
	}
	return { email };
}

// MailCheap Cloud takes anyone, and codes that bounce cost the reputation every later code goes out on; a self-hosted
// server's allowlist already decides who gets one. value: what the email field shows again, to fix.
async function getAddressProblem(email) {
	const suggestion = getEmailSuggestion(email);
	if (suggestion) return { error: `Did you mean ${suggestion}?`, value: suggestion };
	const domain = email.split("@")[1];
	// No code to a throwaway inbox that can't sign up anyway; one that has an account from before still signs in.
	if (classifyDomain(domain, await getDomainLists()) && !(await findUserByEmail(email))) return { error: SIGNUP_ERRORS.email_disposable };
	if ((await findDomainsWithoutMail([domain])).size > 0) return { error: "This email's domain can't receive email", value: email };
	return null;
}

// The first sign-in creates the user, and the user's account with it (lib/auth.js). With an app's
// authorization request, Better Auth carries on with it and answers where to go: the consent page, or back
// to the app if it's already allowed. From an invitation's link, the invited address joins the team as it signs in, a new
// user with the name it was invited with, and the dashboard opens on its newsletter.
export async function verifySigninCode(_state, formData) {
	const email = normalizeEmail(formData.get("email"));
	const code = String(formData.get("code") ?? "").replace(/\s/g, "");
	if (!email) return { error: "Enter a valid email" };
	if (!CODE_PATTERN.test(code)) return { email, error: "Enter the 6-digit code" };

	const requestHeaders = await headers();
	if (await isRateLimited({ ...CHECKS_PER_IP, key: getClientIp(requestHeaders) })) {
		return { email, error: "Too many tries. Try again in 15 minutes." };
	}
	if (!isEmailAllowed(email)) return { email, error: SIGNIN_NOT_ALLOWED_MESSAGE };
	const oauthQuery = readOAuthQueryField(formData.get("oauth_query"));
	const token = String(formData.get("invitation") ?? "");
	const found = oauthQuery ? null : await findInvitation(token);
	const invitation = found && isSameInbox(email, found.member.email) ? found : null;
	let oauthNext = null;
	let signedIn = null;
	try {
		const auth = await getAuth();
		if (oauthQuery) {
			const context = await getAuthCallContext("/sign-in/email-otp");
			oauthNext = (await auth.api.signInEmailOTP({ body: { email, otp: code, oauth_query: oauthQuery }, ...context }))?.url ?? null;
		} else {
			const name = invitation?.member.name;
			signedIn = await auth.api.signInEmailOTP({ body: { email, otp: code, ...(name && { name }) }, headers: requestHeaders });
		}
	} catch (error) {
		const refusal = getSignupError(error?.body?.code);
		if (refusal) return { email, error: refusal };
		return { email, error: isExpiredOAuthQuery(error) ? OAUTH_EXPIRED_MESSAGE : "This code is wrong or expired" };
	}
	await notifyActivity(["New sign-in", email], { withUserAgent: true });
	if (invitation && signedIn?.user) {
		const joined = await acceptInvitation({ token, user: signedIn.user });
		if (joined.newsletterId) {
			await rememberNewsletter(joined.newsletterId);
			redirect("/");
		}
	}
	redirect(oauthNext ?? toSafeNextPath(formData.get("next")));
}

// Google sends refusals back to /signin with Better Auth's error code in ?error=. An app's authorization
// request goes along through Google, and Better Auth carries on with it after the callback.
export async function signinWithGoogle(formData) {
	if (!isGoogleEnabled()) redirect("/signin");
	const oauthQuery = readOAuthQueryField(formData.get("oauth_query"));
	let url;
	try {
		({ url } = await (await getAuth()).api.signInSocial({
			body: {
				provider: "google",
				callbackURL: toSafeNextPath(formData.get("next")),
				errorCallbackURL: oauthQuery ? `/signin?${oauthQuery}` : "/signin",
				...(oauthQuery && { oauth_query: oauthQuery }),
			},
		}));
	} catch (error) {
		if (!isExpiredOAuthQuery(error)) throw error;
		url = `/signin?${oauthQuery}`;
	}
	redirect(url);
}

export async function signOut() {
	await (await getAuth()).api.signOut({ headers: await headers() });
	redirect("/signin");
}
