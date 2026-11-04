import { APP_NAME, isCloud } from "./config.js";
import { getPageMetadata } from "./site.js";
import { MAX_TEAM_MEMBERS } from "./team-rules.js";

export const HELP_PATH = "/help";

// The help center (app/(site)/help): how MailCheap works, in plain words, for the people who use it. Each article is
// the page at /help/<slug>, listed in this order. summary: its line in the index; description: what search results show
// under its title. isCloudOnly: about what only MailCheap Cloud has (plans, the sending pace), so a self-hosted server leaves
// it out and answers 404 for it.
export const HELP_ARTICLES = [
	{
		slug: "getting-started",
		group: "Start",
		title: "Getting started",
		summary: "Sign in, set up your newsletter, choose its design, send your first issue and follow its numbers on the overview.",
		description:
			"How to start with MailCheap: sign in, set up your newsletter, choose its design, add your subscribers, send your first issue and follow its numbers on the overview.",
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
		summary: "Send from the shared address, or from your own domain once its DNS records are in, and what happens when one changes.",
		description:
			"Send your MailCheap newsletter from the shared address with no setup, or from your own domain: its DKIM, return path and DMARC records, step by step, and the daily check of them.",
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
		slug: "website-analytics",
		group: "Your newsletter",
		title: "Website analytics",
		summary: "Google Analytics, Tag Manager, the Meta pixel and your own code on your website: where each ID is and how to check it works.",
		description:
			"Add Google Analytics 4, Google Tag Manager, a Meta pixel or any other tool's code to your MailCheap newsletter's website: where to find each ID, the event each signup sends, and how to check it works.",
	},
	{
		slug: "team",
		group: "Your newsletter",
		title: "Team members",
		summary: "Invite people to a newsletter as admins or members, what each can do, writing a draft together, and removing them.",
		description: `Work on a MailCheap newsletter with your team: invite up to ${MAX_TEAM_MEMBERS} people as admins or members, what each role can do, how invitations work, writing a draft together, and removing someone.`,
	},
	{
		slug: "design",
		group: "Your newsletter",
		title: "Design and themes",
		summary: "Pick a theme for your website and emails, then change its colors, fonts and shapes.",
		description:
			"MailCheap newsletter themes: the presets for your website and emails, and how to change their colors, fonts, heading weight, corners, shadows, spacing and email alignment.",
	},
	{
		slug: "contacts",
		group: "Contacts",
		title: "Contacts",
		summary: "Statuses, selecting many at once, each contact's page, first names, tags and fields, segments, the ways to add people, exports and deleting.",
		description:
			"How contacts work in MailCheap: statuses, selecting many at once, each contact's page with their emails and clicks, first names, tags and fields, segments, adding people, exports and deleting.",
	},
	{
		slug: "importing-contacts",
		group: "Contacts",
		title: "Importing contacts",
		summary: "Bring your list from another platform as a CSV file, with names, tags and fields, and what the import leaves out.",
		description:
			"Import subscribers into MailCheap from Substack, beehiiv, Mailchimp, Kit or any CSV file: the columns it reads, names, tags and fields, and the addresses it leaves out and how to bring some back.",
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
		summary:
			"The editor, the author, pictures, buttons, HTML blocks, moving and deleting blocks, names and fields, sections for some readers, the footer, the preview and test emails.",
		description:
			"Write a newsletter issue in MailCheap's editor: its author, formatting, pictures, buttons, HTML blocks, moving blocks, each reader's name and fields, sections for some readers, the preview and tests.",
	},
	{
		slug: "sending",
		group: "Writing and sending",
		title: "Sending and scheduling",
		summary: "The checks before sending, email, web or both, send now or later, who gets it, first sends in steps and reports.",
		description:
			"Send or schedule a MailCheap campaign by email, on the website or both: the checks it runs first, who gets it, new contacts in steps, pausing a send, and the report of who opened and clicked.",
	},
	{
		slug: "warm-up",
		group: "Writing and sending",
		title: "Sending pace",
		summary: "Why new contacts go in steps, why a new domain's Gmail readers can get a send the next day, and what happens when Gmail asks to slow down.",
		description:
			"How MailCheap keeps your newsletter out of spam: new contacts in steps, a new domain's Gmail readers over two days, and a pause when Gmail asks to slow down.",
		isCloudOnly: true,
	},
	{
		slug: "deliverability",
		group: "Writing and sending",
		title: "Bounces, complaints and pauses",
		summary: "What bounces and spam complaints do, when a send pauses, when an account is blocked, and a test in spam.",
		description:
			"How MailCheap handles bounces and spam complaints: the rates that pause a campaign or block an account, what to check when a test lands in spam, and how to keep yours low.",
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
		summary: "Run everything from code, or from ChatGPT, Claude and other assistants.",
		description:
			"Use MailCheap from code with the REST API, or from ChatGPT, Claude, Grok Bot, Claude Code, Codex and Cursor through its MCP server: API keys and connected apps.",
	},
	{
		slug: "account",
		group: "Account",
		title: "Your account",
		summary: "Signing in, connected apps, and deleting or restoring your account.",
		description: "Your MailCheap account: signing in, the apps connected to it, and deleting it or restoring it within 30 days.",
	},
	{
		slug: "notifications",
		group: "Account",
		title: "Notifications",
		summary: "The bell in the dashboard: what needs you, like a paused campaign, and news, like a finished import.",
		description:
			"MailCheap's notifications: the bell in the dashboard shows what needs you, like a paused campaign or a blocked account, and news, like a finished import or a campaign sent.",
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
