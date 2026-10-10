"use server";

import { isValidObjectId } from "mongoose";
import { revalidatePath } from "next/cache";
import { revalidateArchive } from "@/lib/archive-data";
import { requireSession } from "@/lib/auth";
import { getAppUrl } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { sealSecret } from "@/lib/secret-box";
import { SparkLoopError, createSparkLoop } from "@/lib/sparkloop";
import { getSparkLoopConnection } from "@/lib/sparkloop-account";
import { describeOfferPayout } from "@/lib/sparkloop-format";
import { isCardUrl } from "@/lib/sparkloop-cards";
import { NO_PUBLICATION } from "@/lib/sparkloop-content";
import { WEBHOOK_EVENTS, createWebhookToken } from "@/lib/sparkloop-referrals";
import { WEBHOOK_PATH, canReceiveWebhooks, getWebhookUrl } from "@/lib/sparkloop-webhook";
import Newsletter from "@/models/Newsletter";
import SparkLoopAccount from "@/models/SparkLoopAccount";

const SIGNUP_FLOW_STAGES = ["recommendations", "offers", "survey"];
// What the Offers and Recommendations pages can do, each one call on the publication.
const MANAGE_ACTIONS = {
	recommendOffer: (client, uuid) => client.recommendOffer(uuid),
	archiveOffer: (client, uuid) => client.archiveOffer(uuid),
	reactivateOffer: (client, uuid) => client.reactivateOffer(uuid),
	recommendPaid: (client, uuid, { reason }) => client.recommendPaid(uuid, reason),
	archivePaid: (client, uuid) => client.archivePaid(uuid),
	reactivatePaid: (client, uuid) => client.reactivatePaid(uuid),
	recommendFree: (client, uuid) => client.recommendFree(uuid),
	requestFreePartnership: (client, uuid) => client.requestFreePartnership(uuid),
	archiveFree: (client, uuid) => client.archiveFree(uuid),
	reactivateFree: (client, uuid) => client.reactivateFree(uuid),
};

function revalidateSparkLoop() {
	revalidatePath("/sparkloop", "layout");
}

// SparkLoop's own messages are shown as they are; anything else stays in the logs.
function toError(error, fallback = "SparkLoop request failed") {
	if (error instanceof SparkLoopError) return { error: error.message, status: error.status };
	console.error("[sparkloop]", error);
	return { error: fallback };
}

// Callers check the session first, outside any try: its redirect is thrown, and must not be caught.
async function requireConnection() {
	const connection = await getSparkLoopConnection();
	if (connection.status !== "connected") throw new SparkLoopError("Connect SparkLoop first", 401);
	return connection;
}

async function requirePublication(newsletterId) {
	const { apiKey } = await requireConnection();
	if (!isValidObjectId(newsletterId)) throw new SparkLoopError("Newsletter not found", 404);
	const newsletter = await Newsletter.findById(newsletterId).select("name slug sparkloop").lean();
	const publicationUuid = newsletter?.sparkloop?.publicationUuid;
	if (!publicationUuid) throw new SparkLoopError("Link this newsletter to a SparkLoop publication first", 400);
	return { newsletter, client: createSparkLoop(apiKey).publication(publicationUuid) };
}

// Webhooks left from an earlier connection post to a URL that no longer works, so they go first.
async function registerWebhook(sparkloop) {
	if (!canReceiveWebhooks()) return {};
	const prefix = `${getAppUrl()}${WEBHOOK_PATH}`;
	try {
		const listed = await sparkloop.listWebhooks();
		for (const { uuid, url } of listed.webhooks ?? []) {
			if (typeof url === "string" && url.startsWith(prefix)) await sparkloop.deleteWebhook(uuid).catch(() => {});
		}
		const { token, hash } = createWebhookToken();
		const created = await sparkloop.createWebhook({ url: getWebhookUrl(token), events: WEBHOOK_EVENTS });
		const webhookUuid = created.webhook?.uuid ?? created.uuid;
		return webhookUuid ? { webhookUuid, webhookTokenHash: hash } : {};
	} catch (error) {
		console.error("[sparkloop] Webhook not registered:", error.message);
		return {};
	}
}

// Links to publications this account doesn't have (another account was connected before) go. A newsletter
// is only linked for you when there's nothing to choose: one newsletter, one publication.
async function syncLinks(publications) {
	const uuids = publications.map(({ uuid }) => uuid);
	await Newsletter.updateMany(
		{ "sparkloop.publicationUuid": { $exists: true, $nin: uuids } },
		{ $unset: { "sparkloop.publicationUuid": 1 }, $set: { "sparkloop.signupFlowEnabled": false } }
	);
	const newsletters = await Newsletter.find().select("sparkloop").limit(2).lean();
	if (publications.length === 1 && newsletters.length === 1 && !newsletters[0].sparkloop?.publicationUuid) {
		await Newsletter.updateOne(
			{ _id: newsletters[0]._id },
			{ $set: { "sparkloop.publicationUuid": publications[0].uuid } }
		);
	}
}

export async function connectSparkLoop(_state, formData) {
	await requireSession();
	const apiKey = String(formData.get("apiKey") ?? "").trim();
	if (apiKey.length < 8 || apiKey.length > 200 || /\s/.test(apiKey)) return { error: "Paste the whole API key" };

	const sparkloop = createSparkLoop(apiKey);
	let publications;
	try {
		({ publications = [] } = await sparkloop.listPublications());
	} catch (error) {
		return toError(error);
	}

	await connectDb();
	const webhook = await registerWebhook(sparkloop);
	await SparkLoopAccount.findOneAndUpdate(
		{ singleton: "sparkloop" },
		{
			$set: {
				apiKey: sealSecret(apiKey),
				apiKeyHint: apiKey.slice(-4),
				webhookUuid: webhook.webhookUuid ?? null,
				webhookTokenHash: webhook.webhookTokenHash ?? null,
			},
		},
		{ upsert: true }
	);
	await syncLinks(publications);

	revalidateSparkLoop();
	revalidateArchive();
	return { ok: true };
}

// Best effort: the key may be unreadable or revoked, or the webhook already gone. Without the account,
// the webhook's URL answers 404 anyway.
async function removeWebhook() {
	const connection = await getSparkLoopConnection();
	if (connection.status !== "connected" || !connection.webhookUuid) return;
	await createSparkLoop(connection.apiKey)
		.deleteWebhook(connection.webhookUuid)
		.catch((error) => console.warn("[sparkloop] Webhook not removed:", error.message));
}

// Links to publications stay, so connecting the same account again needs no setup.
export async function disconnectSparkLoop() {
	await requireSession();
	await removeWebhook();
	await SparkLoopAccount.deleteMany({});
	await Newsletter.updateMany({}, { $set: { "sparkloop.signupFlowEnabled": false } });

	revalidateSparkLoop();
	revalidateArchive();
	return { ok: true };
}

export async function setUpReferralWebhook() {
	await requireSession();
	try {
		const { apiKey } = await requireConnection();
		if (!canReceiveWebhooks()) return { error: "SparkLoop only sends to https:// addresses. Set APP_URL to your public URL." };
		const webhook = await registerWebhook(createSparkLoop(apiKey));
		if (!webhook.webhookUuid) return { error: "SparkLoop didn't accept the webhook. Check the logs." };
		await SparkLoopAccount.updateOne({}, { $set: webhook });
		revalidateSparkLoop();
		return { ok: true };
	} catch (error) {
		return toError(error);
	}
}

// One publication per newsletter and one newsletter per publication: its referrals, signup flow and
// earnings are that newsletter's. NO_PUBLICATION unlinks.
export async function linkPublication(newsletterId, publicationUuid) {
	await requireSession();
	try {
		const { apiKey } = await requireConnection();
		if (!isValidObjectId(newsletterId)) return { error: "Newsletter not found" };
		if (publicationUuid === NO_PUBLICATION) {
			await Newsletter.updateOne(
				{ _id: newsletterId },
				{ $unset: { "sparkloop.publicationUuid": 1 }, $set: { "sparkloop.signupFlowEnabled": false } }
			);
		} else {
			const { publications = [] } = await createSparkLoop(apiKey).listPublications();
			if (!publications.some(({ uuid }) => uuid === publicationUuid)) {
				return { error: "That publication isn't on your SparkLoop account" };
			}
			const other = await Newsletter.findOne({ _id: { $ne: newsletterId }, "sparkloop.publicationUuid": publicationUuid })
				.select("name")
				.lean();
			if (other) return { error: `${other.name} is linked to that publication. Unlink it first.` };
			await Newsletter.updateOne({ _id: newsletterId }, { $set: { "sparkloop.publicationUuid": publicationUuid } });
		}
		revalidateSparkLoop();
		revalidateArchive();
		return { ok: true };
	} catch (error) {
		return toError(error);
	}
}

export async function setSignupFlowEmbed(newsletterId, isEnabled) {
	await requireSession();
	try {
		const { newsletter } = await requirePublication(newsletterId);
		await Newsletter.updateOne({ _id: newsletter._id }, { $set: { "sparkloop.signupFlowEnabled": Boolean(isEnabled) } });
		revalidateSparkLoop();
		revalidateArchive();
		return { ok: true };
	} catch (error) {
		return toError(error);
	}
}

export async function setSignupFlowStage(newsletterId, stage, isEnabled) {
	await requireSession();
	if (!SIGNUP_FLOW_STAGES.includes(stage)) return { error: "Unknown stage" };
	try {
		const { client } = await requirePublication(newsletterId);
		await client.setSignupFlowStage(stage, Boolean(isEnabled));
		revalidateSparkLoop();
		return { ok: true };
	} catch (error) {
		return toError(error);
	}
}

export async function manageSparkLoop(newsletterId, action, uuid, options = {}) {
	await requireSession();
	const run = Object.hasOwn(MANAGE_ACTIONS, action) ? MANAGE_ACTIONS[action] : null;
	if (!run) return { error: "Unknown action" };
	const reason = String(options.reason ?? "").trim().slice(0, 1000);
	try {
		const { client } = await requirePublication(newsletterId);
		const result = await run(client, String(uuid ?? ""), { reason });
		revalidateSparkLoop();
		return { ok: true, status: result?.recommendation?.status ?? result?.status ?? null };
	} catch (error) {
		return toError(error);
	}
}

// For the editor's SparkLoop cards: what this newsletter can put in an issue.
export async function listCardOptions(newsletterId) {
	await requireSession();
	try {
		const { client } = await requirePublication(newsletterId);
		const [offers, paid, free] = await Promise.allSettled([
			client.listOffers({ status: "active" }),
			client.listPaid({ status: "active" }),
			client.listFree({ status: "active", role: "sending" }),
		]);
		const value = (result, key) => (result.status === "fulfilled" ? (result.value[key] ?? []) : []);
		// Offers and paid recommendations fail on their own until SparkLoop approves the newsletter.
		if ([offers, paid, free].every(({ status }) => status === "rejected")) return toError(offers.reason);
		return {
			ok: true,
			offers: value(offers, "offers").map(toOfferOption),
			recommendations: [
				...value(paid, "recommendations").map((recommendation) => toRecommendationOption(recommendation, "paid")),
				...value(free, "recommendations").map((recommendation) => toRecommendationOption(recommendation, "free")),
			],
		};
	} catch (error) {
		return toError(error);
	}
}

// A tracked link for one offer or recommendation, so SparkLoop credits clicks to this placement.
export async function createCardLink(newsletterId, card) {
	await requireSession();
	const { kind, uuid, title } = card ?? {};
	if (!["offer", "recommendation"].includes(kind)) return { error: "Unknown card" };
	try {
		const { client } = await requirePublication(newsletterId);
		const name = `${String(title ?? "").slice(0, 80)} · Mailcheap ${new Date().toISOString().slice(0, 10)}`;
		const { campaign } = await client.createCampaign(
			kind === "offer"
				? { type: "specific_offer", name, offerRecommendationUuid: uuid }
				: { type: "specific_recommendation", name, recommendationUuid: uuid }
		);
		if (!isCardUrl(campaign?.public_url)) return { error: "SparkLoop didn't return a link" };
		return { ok: true, url: campaign.public_url };
	} catch (error) {
		return toError(error);
	}
}

function toOfferOption({ uuid, offer }) {
	return {
		uuid,
		kind: "offer",
		title: offer?.headline ?? "",
		description: offer?.description ?? "",
		image: offer?.image_url ?? "",
		logo: offer?.brand?.logo_url ?? "",
		brand: offer?.brand?.name ?? "",
		payout: describeOfferPayout(offer),
	};
}

function toRecommendationOption({ uuid, recommended_publication: publication, commission }, type) {
	return {
		uuid,
		kind: "recommendation",
		type,
		paid: type === "paid",
		title: publication?.name ?? "",
		description: publication?.description ?? "",
		image: "",
		logo: publication?.logo_url ?? "",
		// The headline is the newsletter's name already.
		brand: "",
		payout: type === "paid" && commission ? `${formatMoney(commission)} per subscriber` : "Free",
	};
}
