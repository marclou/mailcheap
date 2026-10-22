import { APP_NAME, isCloud } from "./config.js";
import { getPageMetadata } from "./site.js";

export const HELP_PATH = "/help";

// The help center (app/(site)/help): how MailCheap works, in plain words, for the people who use it. Each article is
// the page at /help/<slug>, listed in this order. summary: its line in the index; description: what search results show
// under its title. isCloudOnly: about what only MailCheap Cloud has (plans, the warm-up), so a self-hosted server leaves
// it out and answers 404 for it.
export const HELP_ARTICLES = [
	{
		slug: "getting-started",
		group: "Start",
		title: "Getting started",
		summary: "Sign in, set up your newsletter and send your first issue.",
		description: "How to start with MailCheap: sign in, set up your newsletter, add your subscribers and send your first issue.",
	},
	{
		slug: "newsletters",
		group: "Your newsletter",
		title: "Newsletter settings",
		summary: "Name, sender, website, signups and the emails new subscribers get.",
		description:
			"MailCheap newsletter settings: name and address, sender and postal address, website, confirmed opt-in, welcome email and list cleanup.",
	},
	{
		slug: "sender-addresses",
		group: "Your newsletter",
		title: "Sender addresses and domains",
		summary: "Send from the shared address, or from your own domain once its DNS records are in.",
		description:
			"Send your MailCheap newsletter from the shared address with no setup, or from your own domain: the DKIM, return path and DMARC records, step by step.",
	},
	{
		slug: "website",
		group: "Your newsletter",
		title: "Website and signups",
		summary: "Each newsletter's website, its issue pages, and how people sign up.",
		description:
			"Every MailCheap newsletter gets a website with a page for each issue and a signup form, plus confirmed opt-in, welcome emails and signup forms on your own site.",
	},
	{
		slug: "design",
		group: "Your newsletter",
		title: "Design and themes",
		summary: "Pick a theme for your website and emails, then change its colors, fonts and shapes.",
		description:
			"MailCheap newsletter themes: the presets for your website and emails, and how to change their colors, fonts, heading weight, corners, shadows and spacing.",
	},
	{
		slug: "contacts",
		group: "Contacts",
		title: "Contacts",
		summary: "Statuses, each contact's page, first names, tags and fields, segments, adding people by hand, exports and deleting.",
		description:
			"How contacts work in MailCheap: statuses, each contact's page with their emails and clicks, first names, tags and fields, segments, adding someone by hand, exporting and deleting.",
	},
	{
		slug: "importing-contacts",
		group: "Contacts",
		title: "Importing contacts",
		summary: "Bring your list from another platform as a CSV file, with names, tags and fields, and what the import leaves out.",
		description:
			"Import subscribers into MailCheap from Substack, beehiiv, Mailchimp, Kit or any CSV file: the columns it reads, first names, tags and fields, and the addresses it leaves out.",
	},
	{
		slug: "list-cleanup",
		group: "Contacts",
		title: "List cleanup",
		summary: "What happens to contacts who stop opening: a last-chance email, then dormant.",
		description:
			"MailCheap's list cleanup: contacts who ignore your issues for months get one last-chance email, and stop getting issues if they don't answer it.",
	},
	{
		slug: "writing",
		group: "Writing and sending",
		title: "Writing an issue",
		summary: "The editor, pictures, moving blocks, names and fields, the preview and test emails.",
		description:
			"Write a newsletter issue in MailCheap's editor: formatting, slash commands, pictures with their alignment and alt text, moving blocks, each reader's name and fields, the preview and test emails.",
	},
	{
		slug: "sending",
		group: "Writing and sending",
		title: "Sending and scheduling",
		summary: "The checks before sending, email, web or both, send now or later, who gets it, first sends in steps and reports.",
		description:
			"Send or schedule a MailCheap campaign by email, on the website or both: the checks it runs first, who gets it, new contacts in steps, pausing a send, and the report with its clicks per link.",
	},
	{
		slug: "warm-up",
		group: "Writing and sending",
		title: "Warm-up and sending pace",
		summary: "Why a new account sends gradually for its first 30 days, and how a send's pace is set.",
		description:
			"What warming up a MailCheap account means: the 30 days after its first campaign, how many emails go out at once, and why bigger sends go out over hours.",
		isCloudOnly: true,
	},
	{
		slug: "deliverability",
		group: "Writing and sending",
		title: "Bounces, complaints and pauses",
		summary: "What bounces and spam complaints do, when a send pauses and when an account is blocked.",
		description:
			"How MailCheap handles bounces and spam complaints: the rates that pause a campaign or block an account, addresses no sender can reach, and how to keep yours low.",
	},
	{
		slug: "plans",
		group: "Account",
		title: "Plans and billing",
		summary: "What counts as an email and a subscriber, the monthly limits, and changing or canceling.",
		description:
			"MailCheap plans and billing: what counts as an email and as a subscriber, what happens at the limit, what works without a plan, and changing or canceling a plan.",
		isCloudOnly: true,
	},
	{
		slug: "api-and-ai",
		group: "Account",
		title: "API and AI assistants",
		summary: "Run everything from code, from ChatGPT and Claude, or from an agent of your own.",
		description:
			"Use MailCheap from code with the REST API, from ChatGPT, Claude, Codex and Cursor through its MCP server, or from an agent through AgentOnboard: API keys, connected apps and agent tokens.",
	},
	{
		slug: "account",
		group: "Account",
		title: "Your account",
		summary: "Signing in, connected apps, and deleting or restoring your account.",
		description: "Your MailCheap account: signing in, the apps connected to it, and deleting it or restoring it within 30 days.",
	},
];

export function getHelpArticles(env = process.env) {
	return HELP_ARTICLES.filter(({ isCloudOnly }) => !isCloudOnly || isCloud(env));
}

export function getHelpArticle(slug, env = process.env) {
	return getHelpArticles(env).find((article) => article.slug === slug) ?? null;
}

// The articles in their groups, in the order the list gives them.
export function getHelpGroups(env = process.env) {
	const groups = new Map();
	for (const article of getHelpArticles(env)) groups.set(article.group, [...(groups.get(article.group) ?? []), article]);
	return [...groups].map(([group, articles]) => ({ group, articles }));
}

export function getHelpHref(slug, section) {
	return `${HELP_PATH}/${slug}${section ? `#${section}` : ""}`;
}

// The help layout's title template doesn't reach /help, which shares its folder, so each page names the help center.
export function getHelpPageMetadata(slug) {
	const { title, description } = HELP_ARTICLES.find((article) => article.slug === slug);
	return getPageMetadata({ title: { absolute: `${title} · ${APP_NAME} help` }, description, path: getHelpHref(slug) });
}
