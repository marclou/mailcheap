import { after } from "next/server";
import { recordEngagement } from "@/lib/email-events";
import { readOpenToken } from "@/lib/tracking";

// A 1×1 transparent GIF.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

// The image always loads; the open is recorded after the response, so readers never wait on it.
export async function GET(_request, { params }) {
	const messageId = readOpenToken((await params).token);
	if (messageId) {
		after(() =>
			recordEngagement({ messageId, type: "Open" }).catch((error) =>
				console.error("[tracking] Open not recorded:", error)
			)
		);
	}
	return new Response(PIXEL, {
		headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0" },
	});
}
