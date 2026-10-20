import crypto from "node:crypto";
import { after } from "next/server";
import { sendAlert } from "@/lib/alerts";
import { isBotRequest } from "@/lib/bot-check";
import { getAppSecret, getAppUrl } from "@/lib/config";
import { cleanFirstName } from "@/lib/contact-fields";
import { getSignupProblem } from "@/lib/contacts";
import { connectDb } from "@/lib/db";
import { findSignupNewsletter } from "@/lib/public-newsletters";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import {
	EMBED_SOURCE,
	SIGNUP_FORM_RATE_LIMITS,
	getHost,
	getSignupFormPaths,
	isAllowedHost,
	toSignupFormSettings,
} from "@/lib/signup-form";
import { MAX_FORM_AGE_MS, MIN_FILL_MS, createDoneToken, readFormToken } from "@/lib/signup-form-token";
import { addSignup } from "@/lib/signups";
import { isObjectIdString, isPlainObject, normalizeEmail } from "@/lib/validation";

// Signups from the forms owners paste on their own sites (lib/signup-form.js). The framed form posts JSON from its own
// page, on MailCheap's host, where Vercel BotID proves a browser sent it; the plain HTML form posts from anywhere and
// lands on /embed/<id>/done. Scripts can name any site, so the owner's list of sites keeps the form off other sites'
// pages and turns the plain form off, and scripts meet the other checks: a hidden field, the framed form's signed load
// time, BotID, the browser's Origin, and limits per visitor, per address and per newsletter. An address gets a few
// signups a day, whichever newsletters ask, and past its limit a newsletter's form pauses, so no script can flood
// strangers with confirmation emails.
const {
	perIp: PER_IP,
	perEmail: PER_EMAIL,
	perNewsletter: PER_NEWSLETTER,
	perNewsletterPlain: PER_NEWSLETTER_PLAIN,
	perNewsletterPlainDaily: PER_NEWSLETTER_PLAIN_DAILY,
} = SIGNUP_FORM_RATE_LIMITS;
const FORM_OFF = "This form isn't taking signups";
const NOT_A_BROWSER = "Couldn't sign you up. Try again from the form.";
const OTHER_SITE = "This form doesn't take signups on this site";
const WINDOWS = { "10 m": "10 minutes", "1 d": "a day" };
const CORS_HEADERS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "POST, OPTIONS",
	"access-control-allow-headers": "content-type, accept",
	"access-control-max-age": "86400",
};

export function OPTIONS() {
	return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request, { params }) {
	const { id } = await params;
	const reply = createReply(request, id);
	const fields = await readFields(request);
	if (!fields) return reply.error(400, "Enter a valid email");
	// People never see this field; bots fill in every input they find.
	if (fields.website) return reply.done({ result: "subscribed" });
	if (!isObjectIdString(id)) return reply.error(404, FORM_OFF);
	if (await isRateLimited({ ...PER_IP, key: getClientIp(request.headers) })) {
		return reply.error(429, "Too many signups from your network. Try again in a few minutes.");
	}

	await connectDb();
	const newsletter = await findSignupNewsletter({ _id: id });
	const settings = toSignupFormSettings(newsletter?.signupForm);
	if (!newsletter || !settings.enabled) return reply.error(404, FORM_OFF);

	// The framed form names the page it was on in its token, from when it loaded; for the plain form, the browser names it.
	// Every browser sends an Origin with a form posted from another site: without one, a script is posting.
	let host;
	if (fields.token) {
		const token = readFormToken(fields.token, { newsletterId: id });
		if (!token || token.age > MAX_FORM_AGE_MS) return reply.error(400, "This form expired. Reload the page and try again.");
		if (token.age < MIN_FILL_MS) return reply.error(400, "One second, then try again.");
		if (await isBotRequest("signup from a form on another site")) return reply.error(403, NOT_A_BROWSER);
		host = getHost(token.origin);
	} else {
		if (settings.allowedDomains.length) {
			await alertPlainFormOff(newsletter);
			return reply.error(403, OTHER_SITE);
		}
		const origin = request.headers.get("origin");
		if (origin === null) return reply.error(400, NOT_A_BROWSER);
		host = getHost(origin) ?? getHost(request.headers.get("referer"));
	}
	if (!isAllowedHost(host, settings.allowedDomains)) return reply.error(403, OTHER_SITE);

	const email = normalizeEmail(fields.email);
	if (!email) return reply.error(400, "Enter a valid email");
	if (await isRateLimited({ ...PER_EMAIL, key: hashEmail(email) })) {
		return reply.error(429, "This address signed up too many times today. Try again tomorrow.");
	}
	const problem = await getSignupProblem(email);
	if (problem) return reply.error(400, problem);

	const isPlain = !fields.token;
	for (const limit of isPlain ? [PER_NEWSLETTER_PLAIN, PER_NEWSLETTER_PLAIN_DAILY] : [PER_NEWSLETTER]) {
		if (!(await isRateLimited({ ...limit, key: id }))) continue;
		await alertFlood(newsletter, { limit, isPlain });
		return reply.error(429, "This form is busy. Try again in a few minutes.");
	}

	const { isPending, inbox } = await addSignup({
		newsletter,
		email,
		source: EMBED_SOURCE,
		sourceDomain: host,
		firstName: settings.askFirstName ? cleanFirstName(fields.firstName) : "",
		confirmReturning: true,
	});
	return reply.done({ result: isPending ? "pending" : "subscribed", inbox });
}

// Once an hour at most: the form refuses signups until they slow down. The limiter answers every refused request of a
// flood, so only the first reaches the alerts and their database.
async function alertFlood(newsletter, { limit, isPlain }) {
	const key = `${newsletter._id}${isPlain ? ":plain" : ""}`;
	if (await isRateLimited({ name: "embed-flood-alert", limit: 1, window: "1 h", key })) return;
	const form = isPlain ? "its HTML form" : "its forms on other sites";
	after(() =>
		sendAlert({
			accountId: newsletter.accountId,
			key: `embed-flood${isPlain ? "-plain" : ""}:${newsletter.slug}`,
			title: "Signup form paused",
			detail: `Over ${limit.limit} signups to ${newsletter.name} from ${form} in ${WINDOWS[limit.window]}, so it refuses new ones until they slow down: no confirmation or welcome email goes to addresses a script typed.${isPlain ? " The script form takes more, since it checks for a real browser." : ""} Check new contacts for junk.`,
			path: "/newsletters/form",
		})
	);
}

// Once a day at most: a plain form still on the owner's site would lose every signup without a word.
async function alertPlainFormOff(newsletter) {
	if (await isRateLimited({ name: "embed-plain-off-alert", limit: 1, window: "1 d", key: String(newsletter._id) })) return;
	after(() =>
		sendAlert({
			accountId: newsletter.accountId,
			key: `embed-plain-off:${newsletter.slug}`,
			title: "HTML signup form refused",
			detail: `A signup to ${newsletter.name} came from its HTML form, which is off while the form's settings list your sites: a plain form can't prove which site it's on. If that form is on your site, paste the script there instead.`,
			path: "/newsletters/form",
			cooldownMinutes: 24 * 60,
		})
	);
}

// JSON for the framed form and for scripts that ask for it; a redirect to the result page for the plain HTML form.
function createReply(request, id) {
	const wantsJson = [request.headers.get("accept"), request.headers.get("content-type")].some((value) =>
		String(value ?? "").includes("application/json")
	);
	const back = request.headers.get("referer") || request.headers.get("origin") || null;

	function redirect(done) {
		const url = new URL(getSignupFormPaths(id).done, getAppUrl());
		url.searchParams.set("s", createDoneToken({ ...done, back }));
		return new Response(null, { status: 303, headers: { ...CORS_HEADERS, location: url.toString() } });
	}

	return {
		done({ result, inbox = null }) {
			if (!wantsJson) return redirect({ result, inbox });
			return Response.json({ ok: true, pending: result === "pending", inbox }, { headers: CORS_HEADERS });
		},
		error(status, message) {
			if (!wantsJson) return redirect({ result: "error", message });
			return Response.json({ error: message }, { status, headers: CORS_HEADERS });
		},
	};
}

async function readFields(request) {
	try {
		const isJson = String(request.headers.get("content-type") ?? "").includes("application/json");
		const body = isJson ? await request.json() : Object.fromEntries(await request.formData());
		if (!isPlainObject(body)) return null;
		const read = (key) => (typeof body[key] === "string" ? body[key] : "");
		return { email: read("email"), firstName: read("first_name") || read("firstName"), website: read("website"), token: read("token") };
	} catch {
		return null;
	}
}

// The limiter keys addresses by a keyed hash, so the rate limit store never holds them.
function hashEmail(email) {
	return crypto.createHmac("sha256", getAppSecret()).update(`embed-email:${email}`).digest("base64url").slice(0, 32);
}
