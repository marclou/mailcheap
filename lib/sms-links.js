import "server-only";
import crypto from "node:crypto";
import { getAppUrl } from "@/lib/config";
import { getLinkKey, normalizeLink } from "@/lib/link-stats";
import CampaignLink from "@/models/CampaignLink";

const CODE_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const URL_REGEX = /https?:\/\/[^\s]+/gi;

export function generateShortCode(length = 6) {
	const bytes = crypto.randomBytes(length);
	let code = "";
	for (let i = 0; i < length; i++) {
		code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
	}
	return code;
}

// Creates or finds a shortened link for an SMS campaign.
export async function createShortLink({ accountId, campaignId, targetUrl }) {
	const normalized = normalizeLink(targetUrl);
	if (!normalized) return targetUrl;

	const key = getLinkKey(normalized);
	let link = await CampaignLink.findOne({ accountId, campaignId, key });

	if (link?.shortCode) {
		return `${getAppUrl()}/s/${link.shortCode}`;
	}

	const shortCode = generateShortCode(6);
	if (link) {
		link.shortCode = shortCode;
		await link.save();
	} else {
		link = await CampaignLink.create({
			accountId,
			campaignId,
			key,
			url: normalized,
			shortCode,
			clicks: 0,
			clickers: 0,
		});
	}

	return `${getAppUrl()}/s/${shortCode}`;
}

// Replaces full URLs in an SMS text with shortened URLs to save characters.
export async function replaceUrlsWithShortLinks(text = "", { accountId, campaignId }) {
	if (!text) return "";
	const matches = [...text.matchAll(URL_REGEX)];
	if (matches.length === 0) return text;

	let result = text;
	for (const match of matches) {
		const originalUrl = match[0];
		const shortUrl = await createShortLink({ accountId, campaignId, targetUrl: originalUrl });
		result = result.replace(originalUrl, shortUrl);
	}
	return result;
}
