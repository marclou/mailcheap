import "server-only";
import { cache } from "react";
import { connectDb } from "@/lib/db";
import { openSecret } from "@/lib/secret-box";
import Newsletter from "@/models/Newsletter";
import SparkLoopAccount from "@/models/SparkLoopAccount";

const NEWSLETTER_FIELDS = "name slug imageUrl archiveEnabled sparkloop";

// "unreadable" means the key was sealed with another SESSION_SECRET: it has to be entered again.
export const getSparkLoopConnection = cache(async () => {
	await connectDb();
	const account = await SparkLoopAccount.findOne().lean();
	if (!account) return { status: "disconnected" };
	const apiKey = openSecret(account.apiKey);
	if (!apiKey) return { status: "unreadable", hint: account.apiKeyHint };
	return {
		status: "connected",
		apiKey,
		hint: account.apiKeyHint,
		connectedAt: account.createdAt,
		webhookUuid: account.webhookUuid ?? null,
	};
});

// A SparkLoop page is about one newsletter: ?newsletter= picks it, otherwise the first one linked.
export async function loadSparkLoopPage(newsletterParam) {
	const connection = await getSparkLoopConnection();
	if (connection.status !== "connected") return connection;

	const newsletters = await Newsletter.find().sort({ createdAt: 1 }).select(NEWSLETTER_FIELDS).lean();
	const selected =
		newsletters.find(({ _id }) => _id.toString() === newsletterParam) ??
		newsletters.find(({ sparkloop }) => sparkloop?.publicationUuid) ??
		newsletters[0] ??
		null;
	return {
		...connection,
		newsletters,
		selected,
		publicationUuid: selected?.sparkloop?.publicationUuid ?? null,
	};
}
