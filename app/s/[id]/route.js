import { after } from "next/server";
import { connectDb } from "@/lib/db";
import CampaignLink from "@/models/CampaignLink";

export const dynamic = "force-dynamic";

const SHORT_CODE_PATTERN = /^[0-9a-zA-Z]{4,16}$/;

export async function GET(request, { params }) {
	const { id } = await params;
	if (!id || !SHORT_CODE_PATTERN.test(id)) {
		return new Response("Invalid link", { status: 404 });
	}

	await connectDb();
	const link = await CampaignLink.findOne({ shortCode: id }).select({ _id: 1, url: 1 }).lean();
	if (!link?.url) {
		return new Response("Link not found", { status: 404 });
	}

	// Verify safe protocol to avoid open redirect vulnerabilities
	const isSafeUrl = link.url.startsWith("http://") || link.url.startsWith("https://");
	if (!isSafeUrl) {
		return new Response("Unsafe destination URL", { status: 400 });
	}

	// Increment clicks asynchronously after returning the redirect response
	after(async () => {
		try {
			await connectDb();
			await CampaignLink.updateOne({ _id: link._id }, { $inc: { clicks: 1 } });
		} catch (error) {
			console.error("[sms-shortener] Failed to record click:", error.message);
		}
	});

	return new Response(null, {
		status: 302,
		headers: {
			Location: link.url,
			"Cache-Control": "no-store",
		},
	});
}
