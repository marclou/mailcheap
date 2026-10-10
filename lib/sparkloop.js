import "server-only";

// SparkLoop's public API, v3: https://docs.sparkloop.app. Every call acts as the account that owns the
// key; almost every one is about one publication (a SparkLoop newsletter, "pub_…").
// SPARKLOOP_API_URL points at another server, like a local mock.
const BASE_URL = (process.env.SPARKLOOP_API_URL || "https://api.sparkloop.app/v3").replace(/\/$/, "");
const TIMEOUT_MS = 10_000;
const UUID_PATTERN = /^[a-z][a-z0-9_]{2,80}$/i;

export class SparkLoopError extends Error {
	constructor(message, status) {
		super(message);
		this.name = "SparkLoopError";
		this.status = status;
	}
}

function errorMessage(status, data) {
	if (status === 401) return "SparkLoop didn't accept the API key";
	// Over 120 requests a minute, the answer is plain text.
	if (status === 429) return "Too many requests to SparkLoop. Try again in a minute.";
	// Anything else that isn't SparkLoop's own short message (a proxy's HTML page, an object) stays out.
	const message = typeof data?.error === "string" ? data.error.trim().slice(0, 200) : "";
	return message || `SparkLoop answered ${status}`;
}

async function request(apiKey, path, { method = "GET", query, body } = {}) {
	const url = new URL(`${BASE_URL}${path}`);
	for (const [key, value] of Object.entries(query ?? {})) {
		if (value === undefined || value === null || value === "") continue;
		url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
	}

	let response;
	try {
		response = await fetch(url, {
			method,
			headers: {
				"x-api-key": apiKey,
				accept: "application/json",
				...(body && { "content-type": "application/json; charset=utf-8" }),
			},
			body: body ? JSON.stringify(body) : undefined,
			cache: "no-store",
			// The key goes in a header, which a redirect to another host would carry along.
			redirect: "error",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch (error) {
		const isTimeout = error?.name === "TimeoutError";
		throw new SparkLoopError(isTimeout ? "SparkLoop took too long to answer" : "Could not reach SparkLoop", 0);
	}

	const text = await response.text();
	let data = null;
	try {
		data = text ? JSON.parse(text) : {};
	} catch {
		data = null;
	}
	if (!response.ok) throw new SparkLoopError(errorMessage(response.status, data), response.status);
	return data ?? {};
}

function id(value) {
	if (!UUID_PATTERN.test(String(value ?? ""))) throw new SparkLoopError("Unknown SparkLoop id", 400);
	return encodeURIComponent(value);
}

// A stats window: SparkLoop defaults to the last 30 days.
function window({ from, to } = {}) {
	return { from, to };
}

export function createSparkLoop(apiKey) {
	const call = (path, options) => request(apiKey, path, options);

	return {
		getAccount: () => call("/account"),
		listPublications: () => call("/publications", { query: { per_page: 200 } }),
		listWebhooks: () => call("/webhooks", { query: { per_page: 200 } }),
		// The docs nest the fields under "webhook"; the endpoint index lists them at the top. Both are sent.
		createWebhook: ({ url, events }) =>
			call("/webhooks", { method: "POST", body: { url, events, webhook: { url, events } } }),
		deleteWebhook: (uuid) => call(`/webhooks/${id(uuid)}`, { method: "DELETE" }),

		publication(publicationUuid) {
			const base = `/publications/${id(publicationUuid)}`;
			const get = (path, query) => call(`${base}${path}`, { query });
			const post = (path, body) => call(`${base}${path}`, { method: "POST", body });

			return {
				get: () => get(""),

				// Signup flow (v2's "Upscribe"): stages are recommendations, offers and survey.
				getSignupFlow: (range) => get("/tools/signup_flow", { expand: "stats", ...window(range) }),
				setSignupFlowStage: (stage, isEnabled) =>
					call(`${base}/tools/signup_flow/${id(stage)}/activation`, { method: isEnabled ? "POST" : "DELETE" }),

				// Welcome survey: one per publication for now.
				listSurveys: () => get("/tools/surveys"),
				getSurvey: (surveyUuid) => get(`/tools/surveys/${id(surveyUuid)}`, { expand: "stats" }),
				listSurveyQuestions: (surveyUuid) => get(`/tools/surveys/${id(surveyUuid)}/questions`, { per_page: 200 }),
				getSurveyQuestionStats: (surveyUuid, questionUuid) =>
					get(`/tools/surveys/${id(surveyUuid)}/questions/${id(questionUuid)}`, { expand: "stats" }),
				listSurveySubmissions: (surveyUuid, { page, perPage = 25 } = {}) =>
					get(`/tools/surveys/${id(surveyUuid)}/submissions`, { page, per_page: perPage }),

				// Offers this publication earns from, and the directory of brand offers to pick from.
				getOfferStats: (range) => get("/earn/offers/stats", window(range)),
				listOffers: ({ status, range } = {}) =>
					get("/earn/offers", { status, expand: "stats", per_page: 100, ...window(range) }),
				browseOffers: ({ q, page, sort } = {}) => get("/earn/directory/offers", { q, page, sort, per_page: 24 }),
				recommendOffer: (uuid) => post(`/earn/directory/offers/${id(uuid)}/recommend`),
				archiveOffer: (uuid) => post(`/earn/offers/${id(uuid)}/archive`),
				reactivateOffer: (uuid) => post(`/earn/offers/${id(uuid)}/reactivation`),

				// Paid recommendations: newsletters this one recommends for a commission.
				getPaidStats: (range) => get("/earn/recommendations/stats", window(range)),
				listPaid: ({ status, range } = {}) =>
					get("/earn/recommendations", {
						status,
						expand: "recommended_publication,stats",
						per_page: 100,
						...window(range),
					}),
				browsePaid: ({ page, orderBy } = {}) =>
					get("/earn/directory/recommendations", {
						page,
						order_by: orderBy,
						exclude_recommended: true,
						per_page: 24,
					}),
				recommendPaid: (uuid, reason) =>
					post(`/earn/directory/recommendations/${id(uuid)}/recommend`, reason ? { reason_for_recommending: reason } : undefined),
				archivePaid: (uuid) => post(`/earn/recommendations/${id(uuid)}/archive`),
				reactivatePaid: (uuid) => post(`/earn/recommendations/${id(uuid)}/reactivation`),

				// Free recommendations, both ways: this one recommending others (sending) and back (receiving).
				getFreeStats: (range) => get("/grow/free_recommendations/stats", window(range)),
				listFree: ({ status, role, range } = {}) =>
					get("/grow/free_recommendations", {
						status,
						role,
						expand: "recommended_publication,recommending_publication,stats",
						per_page: 100,
						...window(range),
					}),
				browseFree: ({ q, page } = {}) => get("/grow/directory/free_recommendations", { q, page, per_page: 24 }),
				recommendFree: (uuid) => post(`/grow/directory/free_recommendations/${id(uuid)}/recommend`),
				requestFreePartnership: (uuid) => post(`/grow/directory/free_recommendations/${id(uuid)}/partnership_request`),
				archiveFree: (uuid) => post(`/grow/free_recommendations/${id(uuid)}/archive`),
				reactivateFree: (uuid) => post(`/grow/free_recommendations/${id(uuid)}/reactivation`),

				// In-email campaigns: a tracked link to one recommendation or offer, for an issue.
				createCampaign: ({ type, name, recommendationUuid, offerRecommendationUuid }) =>
					post("/tools/campaigns", {
						campaign_type: type,
						name,
						recommendation_uuid: recommendationUuid,
						offer_recommendation_uuid: offerRecommendationUuid,
					}),
			};
		},
	};
}
