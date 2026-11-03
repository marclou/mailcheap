import { getErrorStatus, toActionError } from "@/lib/actions/errors";
import { runAction } from "@/lib/actions/run-action";
import { getCurrentAccount } from "@/lib/auth";
import { getSelectedNewsletter } from "@/lib/selected-newsletter";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-image";

// The account of the newsletter the dashboard has open, whose library a team member's pictures go in too.
async function findContext() {
	if (!(await getCurrentAccount())) return null;
	const { user, account } = await getSelectedNewsletter();
	return { user, account };
}

// The image picker's library: the account's images, newest first, through the same list_images action as the API.
export async function GET(request) {
	const current = await findContext();
	if (!current) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const cursor = new URL(request.url).searchParams.get("cursor")?.slice(0, 200);
	try {
		const { images, nextCursor } = await runAction("list_images", { ...current, via: "dashboard", input: { cursor: cursor || undefined } });
		return Response.json({ images, nextCursor });
	} catch (error) {
		const { code, message } = toActionError(error);
		return Response.json({ error: message, code }, { status: getErrorStatus(code) });
	}
}

// The editor's and the picker's uploads: the file as the body, through the same upload_image action as the API.
// Archives on <slug>.<shared domain> are the same site as the dashboard when the shared domain is the app's own,
// so the session cookie comes with their requests too: only the dashboard's own pages upload.
export async function POST(request) {
	const site = request.headers.get("sec-fetch-site");
	if (site && site !== "same-origin") return Response.json({ error: "Forbidden" }, { status: 403 });
	const current = await findContext();
	if (!current) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const bytes = Buffer.from(await request.arrayBuffer());
	if (bytes.length > MAX_UPLOAD_BYTES) return Response.json({ error: "Images must be under 4 MB" }, { status: 413 });
	try {
		const { url } = await runAction("upload_image", {
			...current,
			via: "dashboard",
			input: {
				base64: bytes.toString("base64"),
				fileName: request.headers.get("x-file-name")?.slice(0, 200),
				contentType: request.headers.get("content-type")?.slice(0, 100),
			},
		});
		return Response.json({ url });
	} catch (error) {
		const { code, message } = toActionError(error);
		return Response.json({ error: message, code }, { status: code === "validation_failed" ? 415 : getErrorStatus(code) });
	}
}
