import { isBotIdEnabled } from "@/lib/bot-check";
import { connectDb } from "@/lib/db";
import { findSignupNewsletter } from "@/lib/public-newsletters";
import { getFramePolicy, getHost, getSignupFormPaths, isAllowedHost, toSignupFormSettings } from "@/lib/signup-form";
import { renderFormPage, renderNoticePage } from "@/lib/signup-form-page";
import { createFormToken } from "@/lib/signup-form-token";
import { isObjectIdString } from "@/lib/validation";

const HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" };

// The signup form in the frame public/embed.js adds to the owner's site. Its token carries the time it loaded and the
// page holding it, as that page's browser names it in the referrer: sites keep the origin in it by default. A script
// can name any page, so the post also proves a browser sent it (app/api/embed/[id]/route.js).
export async function GET(request, { params }) {
	const { id } = await params;
	if (!isObjectIdString(id)) return respond(renderNoticePage("This signup form doesn't exist."), 404);

	await connectDb();
	const newsletter = await findSignupNewsletter({ _id: id });
	const settings = toSignupFormSettings(newsletter?.signupForm);
	if (!newsletter || !settings.enabled) return respond(renderNoticePage("Signups are closed for now."), 404);

	const referer = request.headers.get("referer");
	const host = getHost(referer);
	if (!isAllowedHost(host, settings.allowedDomains)) return respond(renderNoticePage("This form doesn't work on this site."), 403);

	const token = createFormToken({ newsletterId: id, origin: host ? new URL(referer).origin : "" });
	const html = renderFormPage({ newsletter, settings, endpoint: getSignupFormPaths(id).endpoint, token, botId: isBotIdEnabled() });
	return respond(html, 200, getFramePolicy(settings.allowedDomains));
}

function respond(html, status = 200, policy = null) {
	return new Response(html, { status, headers: { ...HEADERS, ...(policy && { "content-security-policy": policy }) } });
}
