// SparkLoop's links and the words that present each feature. Shared by server and client components.

// Off: the SparkLoop pages and editor cards stay out of the way until an account is connected, and
// /sparkloop is reached from the README or a newsletter's settings. On: they show from the start,
// each page explaining its feature.
export const SPARKLOOP_PITCH = false;

export const SPARKLOOP_SIGNUP_URL = "https://dash.sparkloop.app/signup?aff=010ac617";

// The publication picker's "not on SparkLoop" choice.
export const NO_PUBLICATION = "none";

const DASHBOARD = "https://dash.sparkloop.app";

// Paths from SparkLoop's help center. Earn → Offers has no documented path; it's the Earn section's.
export const SPARKLOOP_URLS = {
	dashboard: DASHBOARD,
	apiKey: `${DASHBOARD}/settings/integrations`,
	publications: `${DASHBOARD}/settings/publications`,
	script: `${DASHBOARD}/settings/script`,
	signupFlow: `${DASHBOARD}/tools/signup_flow`,
	signupFlowEditor: `${DASHBOARD}/tools/signup_flow/editor`,
	survey: `${DASHBOARD}/tools/signup_flow/editor`,
	earn: `${DASHBOARD}/earn/overview`,
	offers: `${DASHBOARD}/earn/offers`,
	paidRecommendations: `${DASHBOARD}/earn/paid_recommendations/overview`,
	freeRecommendations: `${DASHBOARD}/grow/free_recommendations/overview`,
	partnerApplication: `${DASHBOARD}/paid_recommendations/partner_network_application/checklist`,
};

export const SPARKLOOP_INTRO = {
	headline: "Grow and earn from your signups",
	body: "SparkLoop shows new readers other newsletters and brand offers right after they subscribe, and sends you readers from newsletters that recommend you. Your list stays in your database: SparkLoop only gets a reader's email when they sign up on your archive or click a card in an issue.",
};

export const SPARKLOOP_FEATURES = {
	"signup-flow": {
		title: "Signup flow",
		headline: "Earn from new signups",
		body: "Right after someone subscribes on your archive, SparkLoop shows them a few newsletters to join, a short survey and brand offers. You earn when a reader joins a paid recommendation or claims an offer.",
		points: [
			"Turn it on for your archive's signup forms from here",
			"Paid recommendations pay per confirmed subscriber, offers per lead, click or sale",
			"Free recommendations send readers back to you",
		],
		requirement: "Earning needs SparkLoop to approve your newsletter as a partner. Free recommendations work right away.",
	},
	survey: {
		title: "Welcome survey",
		headline: "Ask new readers who they are",
		body: "Add a few questions to the signup flow: what they do, what they want from you. Write the questions in SparkLoop; the answers show up here, with each reader's email.",
		points: [
			"One choice, several choices or free text",
			"Counts for each answer as they come in",
			"Numbers about your audience to show sponsors",
		],
		requirement: "The survey runs inside the signup flow, so turn that on too.",
	},
	offers: {
		title: "Offers",
		headline: "Earn from brand offers, no sales calls",
		body: "Pick offers from brands in SparkLoop's network. Readers see them after they sign up, or in an issue as a card. You earn per lead, click or sale.",
		points: [
			"See what each offer pays, and where readers need to live, before adding it",
			"Show them after each signup, or add one to an issue from the editor",
			"Cards in emails are labeled Sponsored",
		],
		requirement: "Offers open once SparkLoop approves your newsletter as a partner. Apply in SparkLoop after you connect.",
	},
	recommendations: {
		title: "Recommendations",
		headline: "Recommend newsletters, get recommended back",
		body: "Swap free recommendations with other newsletters, so their new readers can join yours. Once SparkLoop approves you as a partner, join paid programs and earn for each reader you send.",
		points: [
			"Thousands of newsletters to swap with",
			"Readers they send you join your Mailcheap list",
			"Paid programs pay per confirmed subscriber",
		],
		requirement: "Free recommendations work right away. Paid ones open once SparkLoop approves your newsletter as a partner.",
	},
};
