import "server-only";
import * as z from "zod";
import { scoped } from "@/lib/account-scope";
import { areWelcomeEmailsPaused } from "@/lib/account-state";
import { defineAction } from "@/lib/actions/define-action";
import { actionError } from "@/lib/actions/errors";
import { DnsStepsSchema, assertSendingEnabled, dateOutput, findNewsletter, findTestRecipient, toDnsSteps, toIso } from "@/lib/actions/shared";
import { revalidateArchive } from "@/lib/archive-data";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { cleanupTotalsPipeline, getCleanupSettings } from "@/lib/cleanup";
import { getAppUrl, getArchiveCnameTarget, getSharedDomain } from "@/lib/config";
import { getConfirmationContent, getConfirmationProblem } from "@/lib/confirmation-content";
import { listNewslettersWithActiveCounts } from "@/lib/contacts";
import { formatWindow } from "@/lib/format";
import {
	applySharedAddress,
	getNewsletterProblem,
	getSlugFormatProblem,
	mergeNewsletterSettings,
	toNewsletterDocument,
	toNewsletterSettings,
} from "@/lib/newsletter-settings";
import { MAX_NEWSLETTERS_PER_ACCOUNT, NEWSLETTER_LIMIT_MESSAGE, SLUG_CHANGES } from "@/lib/newsletters";
import { findFreeSlug } from "@/lib/onboarding";
import { getPostalAddress, toPostalAddressFields } from "@/lib/postal-address";
import { isRateLimited } from "@/lib/rate-limit";
import { findAccountDomains } from "@/lib/sender";
import { getFromEmailSaveProblem, getSharedAddress } from "@/lib/sender-rules";
import { sendWelcomeTestEmail } from "@/lib/sending";
import { syncSharedSender } from "@/lib/shared-sender";
import { getSignupEmailReviewStatuses, reviewSignupEmails } from "@/lib/signup-email-review";
import { SIGNUP_FORM_DEFAULTS, SIGNUP_FORM_LAYOUTS, SIGNUP_FORM_LIMITS, getEmbedCode, getSignupFormPaths } from "@/lib/signup-form";
import { siteExtensions } from "@/lib/site-extensions";
import { countStoppedContacts } from "@/lib/stopped-contacts";
import { SUMMARY_FREQUENCIES, SUMMARY_HOUR, getSummaryFrequency } from "@/lib/summary";
import { FONT_IDS, THEME_FONTS } from "@/lib/theme-fonts";
import {
	HEADING_WEIGHTS,
	PRESET_IDS,
	RADIUS_OPTIONS,
	SHADOW_OPTIONS,
	SPACING_OPTIONS,
	THEME_PRESETS,
	getThemeOutput,
} from "@/lib/themes";
import { getWebsiteDomainSetup } from "@/lib/website-domain-rules";
import { checkWebsiteDomain, removeWebsiteDomain, setWebsiteDomain } from "@/lib/website-domains";
import Contact from "@/models/Contact";
import Newsletter from "@/models/Newsletter";

const GROUP = "Newsletters";
const text = (max) => z.string().trim().max(max);
const email = z.string().trim().toLowerCase().max(254);
const hexColor = z
	.string()
	.trim()
	.regex(/^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, "Use a hex color, like #1a1a1a");
const headingWeight = z
	.number()
	.int()
	.refine((weight) => HEADING_WEIGHTS.includes(weight), `One of ${HEADING_WEIGHTS.join(", ")}`);

const ThemeInput = z
	.object({
		preset: z
			.enum(PRESET_IDS)
			.optional()
			.describe("A preset from list_themes. Another preset starts over from it: the changes made to the one before go, unless this call sends new ones."),
		colors: z
			.object({
				background: hexColor.nullable().optional().describe("The page"),
				text: hexColor.nullable().optional(),
				accent: hexColor.nullable().optional().describe("Buttons and links"),
			})
			.nullable()
			.optional()
			.describe("Hex colors. null takes one back to the preset's; the other shades derive from these three."),
		fonts: z
			.object({ heading: z.enum(FONT_IDS).nullable().optional(), body: z.enum(FONT_IDS).nullable().optional() })
			.nullable()
			.optional()
			.describe("Fonts from list_themes. Mail clients without web fonts, like Gmail, show a close system font."),
		headingWeight: headingWeight.nullable().optional().describe("Fonts with fewer weights use their closest"),
		radius: z.enum(RADIUS_OPTIONS).nullable().optional().describe("Corners of buttons, cards and pictures"),
		shadow: z.enum(SHADOW_OPTIONS).nullable().optional().describe("Cards and forms on the website. Emails have none."),
		spacing: z.enum(SPACING_OPTIONS).nullable().optional().describe("Line height and space between paragraphs"),
	})
	.describe(
		"Its look on its website and in its emails: a preset from list_themes and what's changed on top of it. Send only what changes; null takes a choice back to the preset's."
	);

const ThemeOutput = z.object({
	preset: z.string(),
	name: z.string(),
	customized: z.array(z.string()).describe("What was changed on top of the preset: colors, fonts, headingWeight, radius, shadow or spacing"),
	colors: z.object({ background: z.string(), text: z.string(), accent: z.string() }),
	fonts: z.object({ heading: z.string(), body: z.string() }),
	headingWeight: z.number().int(),
	radius: z.string(),
	shadow: z.string(),
	spacing: z.string(),
});

const SignupFormSettings = z.object({
	enabled: z.boolean(),
	layout: z.enum(SIGNUP_FORM_LAYOUTS),
	headline: z.string().nullable().describe("The card's headline. null: the newsletter's name. Empty: none."),
	subheadline: z.string().nullable().describe("The line under the card's headline. null: the newsletter's description. Empty: none."),
	askFirstName: z.boolean().describe("Asks for a first name above the email, optional for readers"),
	buttonText: z.string(),
	placeholder: z.string(),
	allowedDomains: z.array(z.string()).describe("Empty: any site. With sites listed, only the script form takes signups"),
});

const settingsShape = {
	name: text(100).describe("The newsletter's name, shown in emails and on the archive"),
	slug: z
		.string()
		.trim()
		.toLowerCase()
		.max(40)
		.describe(
			"Lowercase letters, digits and dashes, not a name MailCheap keeps like www, api or mail. The shared from address (hello@<slug>.<shared domain>) and the website's address on the shared domain follow it."
		),
	imageUrl: text(500).describe("Square logo, 128×128 or larger: an https:// link"),
	fromName: text(100).describe("Name in the From field"),
	fromEmail: email.describe(
		"The shared address (hello@<slug>.<shared domain>, set automatically) or an address on a domain added to this account"
	),
	replyTo: email.describe("Where replies go. Empty: replies to the shared address go to the account owner."),
	postalAddress: text(500).describe(
		"Printed in the footer of every email. Never set, it's the server's default (MailCheap's address on MailCheap Cloud, none on a self-hosted server); saved empty, there's none and sending waits for one."
	),
	archiveEnabled: z
		.boolean()
		.describe("A public page for each sent issue, with a signup form. On for new newsletters: the website goes live after the first issue."),
	description: text(1000).describe("One sentence under the name on the archive, 200 characters at most"),
	author: z
		.object({
			bio: text(1000).optional().describe("Under the author's name on the archive, 160 characters at most"),
			imageUrl: text(500).optional().describe("Author photo: an https:// link. The newsletter image otherwise."),
		})
		.describe("The archive's author page; the author's name is fromName"),
	socialLinks: z.array(text(300)).max(20).describe("https:// links shown on the archive, 8 at most"),
	requireConfirmation: z
		.boolean()
		.describe(
			"Confirmed opt-in: new signups get an email with a button and only join once they click it. On for new newsletters. New subscribers get the confirmation email or the welcome email: turning it on while the welcome email is on needs welcome.enabled false in the same request."
		),
	cleanup: z
		.object({
			enabled: z.boolean().optional().describe("On for new newsletters"),
			issues: z.number().nullable().optional().describe("Ignored issues in a row before the last-chance email, 2 to 100. Default 6."),
			days: z.number().nullable().optional().describe("Days without an open, click or signup, 30 to 3650. Default 180."),
		})
		.describe(
			"List cleanup at each send: contacts who ignored several issues get a last-chance email instead, and become dormant if they don't answer"
		),
	welcome: z
		.object({
			enabled: z.boolean().optional(),
			subject: text(200).optional(),
			previewText: text(300).optional(),
			markdown: z.string().max(100_000).optional().describe("Markdown"),
		})
		.describe(
			"Email sent to each new subscriber, while signups don't need confirming: turning it on while requireConfirmation is on needs requireConfirmation false in the same request. MailCheap's content check reads it when it's saved: see welcome.review in the answer."
		),
	confirmation: z
		.object({
			subject: text(200).optional(),
			previewText: text(300).optional(),
			markdown: z
				.string()
				.max(100_000)
				.optional()
				.describe('Markdown that keeps the button: an HTML link like <a href="{{confirm_url}}">Confirm</a>'),
		})
		.describe(
			"The confirmation email for confirmed opt-in. Sent back unchanged, the built-in one stays built-in and follows the name and description. MailCheap's content check reads your own when it's saved: see confirmation.review in the answer."
		),
	signupForm: z
		.object({
			enabled: z.boolean().optional().describe("Off for new newsletters"),
			layout: z
				.enum(SIGNUP_FORM_LAYOUTS)
				.optional()
				.describe("inline, the fields and button alone; card, in a box under a headline and a line of text"),
			headline: text(SIGNUP_FORM_LIMITS.headline)
				.nullable()
				.optional()
				.describe("The card's headline. null: the newsletter's name, as it changes. Empty: no headline."),
			subheadline: text(SIGNUP_FORM_LIMITS.subheadline)
				.nullable()
				.optional()
				.describe("The line under the card's headline. null: the newsletter's description, as it changes. Empty: no line."),
			askFirstName: z.boolean().optional().describe("Asks for a first name above the email, optional for readers. Off by default."),
			buttonText: text(SIGNUP_FORM_LIMITS.buttonText).optional().describe(`Default: ${SIGNUP_FORM_DEFAULTS.buttonText}`),
			placeholder: text(SIGNUP_FORM_LIMITS.placeholder).optional().describe(`Default: ${SIGNUP_FORM_DEFAULTS.placeholder}`),
			allowedDomains: z
				.array(text(253))
				.max(SIGNUP_FORM_LIMITS.domains)
				.optional()
				.describe(
					"Sites where browsers show the form, like example.com, which covers its subdomains. Empty: any site. With sites listed, only the script form takes signups: the plain HTML form can't prove which site it's on."
				),
		})
		.describe("The signup form for the newsletter's own site. get_signup_form gives the code to paste."),
	theme: ThemeInput,
	notifications: z
		.object({
			summary: z
				.enum(SUMMARY_FREQUENCIES)
				.optional()
				.describe(
					`How often the account owner gets an email of the newsletter's numbers: weekly, every Monday at ${SUMMARY_HOUR} AM in their time zone, the default; daily, every morning with the day before, skipping days with no news; or off. On MailCheap Cloud, with a paid plan. preview_summary_email shows it.`
				),
		})
		.describe("What MailCheap emails the account owner about this newsletter, each newsletter on its own. Send only what changes."),
};

const WebsiteDomainSchema = z.object({
	host: z.string(),
	live: z.boolean().describe("The website and the links in the newsletter's next emails are on this host"),
	pointed: z.boolean().describe("Its CNAME points at MailCheap, as last checked"),
	status: z.string().describe("In words: Waiting for DNS, Live, Not pointing at MailCheap"),
	setup: DnsStepsSchema.describe(
		"The DNS records to add where the domain's DNS is managed, step by step: a CNAME to MailCheap, a TXT record that proves it's yours, and Vercel's own TXT record when the domain is used on Vercel. Once it's live, only the CNAME stays."
	),
	checkedAt: dateOutput,
});

const SignupEmailReview = z
	.object({
		status: z.enum(["in_review", "rejected"]),
		note: z.string().nullable().describe("MailCheap's message when it rejected it"),
	})
	.nullable();
const REVIEW_HELP =
	"MailCheap's content check holds an email that looks clearly harmful: in_review while a person checks it, usually within a few hours, rejected when it can't be sent. Changing it has it checked again. null: it goes out.";

const NewsletterSchema = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	imageUrl: z.string(),
	fromName: z.string(),
	fromEmail: z.string(),
	replyTo: z.string(),
	postalAddress: z.string().describe("What its emails print: its own address, else the server's default"),
	sharedAddress: z.string().nullable().describe("The shared from address for this slug, when the server has a shared domain"),
	archiveEnabled: z.boolean(),
	archiveUrl: z.string().nullable().describe("The website's address while it's on. It goes live after the first issue."),
	websiteDomain: WebsiteDomainSchema.nullable().describe(
		"The newsletter's own domain for its website and the links in its emails, being set up or live (set_website_domain). null without one, or on a server that doesn't put websites on customers' domains."
	),
	description: z.string(),
	author: z.object({ bio: z.string(), imageUrl: z.string() }),
	socialLinks: z.array(z.string()),
	requireConfirmation: z.boolean(),
	welcome: z.object({
		enabled: z.boolean(),
		subject: z.string(),
		previewText: z.string(),
		markdown: z.string(),
		paused: z
			.boolean()
			.describe("The account used up this month's emails: no welcome email goes out until the count starts over or the plan grows"),
		review: SignupEmailReview.describe(`${REVIEW_HELP} Meanwhile, new subscribers get no welcome email.`),
	}),
	confirmation: z.object({
		subject: z.string(),
		previewText: z.string(),
		markdown: z.string(),
		isCustom: z.boolean().describe("False while the built-in confirmation email goes out"),
		review: SignupEmailReview.describe(`${REVIEW_HELP} Meanwhile, new subscribers get the built-in confirmation email.`),
	}),
	cleanup: z.object({
		enabled: z.boolean(),
		issues: z.number().int(),
		days: z.number().int(),
		waiting: z.number().int().describe("Got the last-chance email and haven't answered yet"),
		kept: z.number().int().describe("Answered the last-chance email"),
		dormant: z.number().int(),
		noMailServer: z.number().int().describe("Stopped by the list hygiene: their domain can't receive email"),
		spamDomain: z.number().int().describe("Stopped by the list hygiene: their domain is a known spam domain"),
	}),
	signupForm: SignupFormSettings,
	theme: ThemeOutput,
	notifications: z.object({ summary: z.enum(SUMMARY_FREQUENCIES).describe("How often the owner gets its summary email") }),
	activeContacts: z.number().int(),
	createdAt: dateOutput,
	updatedAt: dateOutput,
});

function toWebsiteDomain(account, newsletter) {
	const setup = getWebsiteDomainSetup(newsletter, { accountId: account._id, cnameTarget: getArchiveCnameTarget() });
	if (!setup) return null;
	return {
		host: setup.host,
		live: setup.isLive,
		pointed: setup.isPointed,
		status: setup.status.label,
		setup: toDnsSteps(setup.steps),
		checkedAt: toIso(setup.checkedAt),
	};
}

async function toNewsletter(account, newsletter, activeContacts) {
	const [[totals], stopped, reviews] = await Promise.all([
		Contact.aggregate(cleanupTotalsPipeline({ accountId: newsletter.accountId, newsletterId: newsletter._id })),
		countStoppedContacts({ accountId: newsletter.accountId, newsletterId: newsletter._id }),
		getSignupEmailReviewStatuses(newsletter),
	]);
	const { postalAddressCleared, ...settings } = toNewsletterSettings(newsletter);
	const confirmation = getConfirmationContent(newsletter);
	return {
		id: String(newsletter._id),
		...settings,
		postalAddress: getPostalAddress(newsletter, siteExtensions.defaultPostalAddress),
		welcome: { ...settings.welcome, paused: areWelcomeEmailsPaused(account), review: reviews.welcome },
		sharedAddress: getSharedAddress(newsletter.slug),
		archiveUrl: newsletter.archiveEnabled ? getArchiveUrls(newsletter).siteIndex : null,
		websiteDomain: toWebsiteDomain(account, newsletter),
		confirmation: {
			subject: confirmation.subject,
			previewText: confirmation.previewText,
			markdown: confirmation.markdown,
			isCustom: Boolean(newsletter.confirmation?.subject) && !getConfirmationProblem(newsletter.confirmation),
			review: reviews.confirmation,
		},
		cleanup: {
			...getCleanupSettings(newsletter),
			waiting: totals?.waiting ?? 0,
			kept: totals?.kept ?? 0,
			dormant: totals?.dormant ?? 0,
			...stopped,
		},
		theme: getThemeOutput(newsletter.theme),
		notifications: { summary: getSummaryFrequency(newsletter) },
		activeContacts:
			activeContacts ?? (await Contact.countDocuments({ accountId: newsletter.accountId, newsletterId: newsletter._id, status: "active" })),
		createdAt: toIso(newsletter.createdAt),
		updatedAt: toIso(newsletter.updatedAt),
	};
}

const SLUG_TAKEN = "This slug is already used";

// Slugs are unique across accounts (the index on Newsletter.slug); a newsletter's own slug isn't taken for it.
function isSlugTaken(slug, newsletterId = null) {
	return Newsletter.exists({ slug, ...(newsletterId && { _id: { $ne: newsletterId } }) }).setOptions({ crossAccount: true });
}

// A slug another newsletter has is refused before it counts.
async function countSlugChange(account, slug) {
	if (await isSlugTaken(slug)) throw actionError("conflict", SLUG_TAKEN);
	if (await isRateLimited({ ...SLUG_CHANGES, key: String(account._id) })) {
		throw actionError("rate_limited", `You can change slugs ${SLUG_CHANGES.limit} times ${formatWindow(SLUG_CHANGES.window)}. Try again later.`);
	}
}

// New subscribers get the confirmation email or the welcome email, never both: a change that turns one on turns the other
// off in the same request, as the dashboard does once its owner has seen the warning. Newsletters saved before the rule
// can have both on; other changes still save, and the welcome email doesn't go out (lib/sending-rules.js).
function getSignupEmailsProblem(changes, settings) {
	if (!settings.requireConfirmation || !settings.welcome.enabled) return null;
	if (changes.welcome?.enabled === true) {
		return "Double opt-in is on, and new subscribers get the confirmation email instead of the welcome email. Send requireConfirmation: false with welcome.enabled: true to switch to the welcome email.";
	}
	if (changes.requireConfirmation === true) {
		return "The welcome email is on. With double opt-in, new subscribers get the confirmation email instead: send welcome.enabled: false with requireConfirmation: true to switch.";
	}
	return null;
}

// The same checks as the settings form: the shared address follows the slug, and a from address is the
// shared one or on a domain the account added.
async function saveNewsletter({ account, existing, changes }) {
	const merged = mergeNewsletterSettings(toNewsletterSettings(existing), changes);
	const address = "postalAddress" in changes ? toPostalAddressFields(changes.postalAddress, siteExtensions.defaultPostalAddress) : {};
	const settings = applySharedAddress({ ...merged, ...address }, getSharedDomain());
	const problem = getNewsletterProblem(settings) ?? getSignupEmailsProblem(changes, settings);
	if (problem) throw actionError("validation_failed", problem);
	const fromProblem = getFromEmailSaveProblem({ ...settings, domains: await findAccountDomains(account._id) });
	if (fromProblem) throw actionError("sender_not_allowed", fromProblem);
	if (existing && settings.slug !== existing.slug) await countSlugChange(account, settings.slug);

	const document = toNewsletterDocument(settings);
	let id = existing?._id;
	try {
		if (existing) {
			const { matchedCount } = await Newsletter.updateOne(scoped(account, { _id: id }), { $set: document }, { runValidators: true });
			if (!matchedCount) throw actionError("not_found", "Newsletter not found");
		} else {
			if ((await Newsletter.countDocuments(scoped(account))) >= MAX_NEWSLETTERS_PER_ACCOUNT) {
				throw actionError("conflict", NEWSLETTER_LIMIT_MESSAGE);
			}
			id = (await Newsletter.create({ ...document, accountId: account._id }))._id;
		}
	} catch (error) {
		if (error?.code === 11000) throw actionError("conflict", SLUG_TAKEN);
		throw error;
	}

	await syncSharedSender({ account, newsletter: await Newsletter.findOne(scoped(account, { _id: id })).lean() });
	await reviewSignupEmails({ account, newsletterId: id });
	revalidateArchive();
	return toNewsletter(account, await Newsletter.findOne(scoped(account, { _id: id })).lean());
}

export const newsletterActions = [
	defineAction({
		name: "list_newsletters",
		tryWithoutPlan: true,
		title: "List newsletters",
		group: GROUP,
		description: `Lists the account's newsletters, ${MAX_NEWSLETTERS_PER_ACCOUNT} at most, first created first, with their settings and active contacts. Actions that take a newsletter use the first one when it's left out.`,
		http: { method: "GET", path: "/newsletters" },
		readOnly: true,
		output: z.object({ newsletters: z.array(NewsletterSchema) }),
		handler: async ({ account }) => {
			const newsletters = await listNewslettersWithActiveCounts(account);
			return { newsletters: await Promise.all(newsletters.map((newsletter) => toNewsletter(account, newsletter, newsletter.activeCount))) };
		},
	}),
	defineAction({
		name: "get_newsletter",
		tryWithoutPlan: true,
		title: "Get a newsletter",
		group: GROUP,
		description:
			"Gets a newsletter's settings: sender, postal address, welcome and confirmation emails, list cleanup, archive, theme and notifications.",
		http: { method: "GET", path: "/newsletters/{id}" },
		readOnly: true,
		input: z.object({ id: z.string().trim().min(1).max(100).describe("The newsletter's ID or slug") }),
		output: NewsletterSchema,
		handler: async ({ account, input }) => toNewsletter(account, await findNewsletter(account, input.id)),
	}),
	defineAction({
		name: "create_newsletter",
		tryWithoutPlan: true,
		title: "Create a newsletter",
		group: GROUP,
		description:
			`Creates a newsletter. An account has up to ${MAX_NEWSLETTERS_PER_ACCOUNT}, sharing its plan's emails and subscribers; one more answers conflict. Without a fromEmail it sends from the shared address hello@<slug>.<shared domain>, which MailCheap sets up in a few minutes. List cleanup is on unless cleanup.enabled is false. Without a postalAddress, its emails print the server's default if it has one: MailCheap's address on MailCheap Cloud.`,
		http: { method: "POST", path: "/newsletters", status: 201 },
		example: { name: "Field notes", postalAddress: "Field Notes Ltd, 1 Main St, Paris, France" },
		input: z.object({
			...Object.fromEntries(Object.entries(settingsShape).map(([key, schema]) => [key, schema.optional()])),
			name: settingsShape.name.min(1),
			slug: settingsShape.slug
				.optional()
				.describe("Lowercase letters, digits and dashes. Default: made from the name, numbered when another newsletter has it."),
		}),
		output: NewsletterSchema,
		handler: async ({ account, input }) =>
			saveNewsletter({ account, existing: null, changes: { ...input, slug: input.slug || (await findFreeSlug(input.name)) } }),
	}),
	defineAction({
		name: "update_newsletter",
		tryWithoutPlan: true,
		title: "Update a newsletter",
		group: GROUP,
		description: `Changes a newsletter's settings. Send only the fields to change; nested groups (welcome, confirmation, cleanup, author) keep the fields you leave out. An account changes slugs ${SLUG_CHANGES.limit} times ${formatWindow(SLUG_CHANGES.window)} at most: one more answers rate_limited.`,
		http: { method: "PATCH", path: "/newsletters/{id}" },
		idempotent: true,
		example: { replyTo: "jane@example.com", requireConfirmation: true },
		input: z.object({
			id: z.string().trim().min(1).max(100).describe("The newsletter's ID or slug"),
			...Object.fromEntries(Object.entries(settingsShape).map(([key, schema]) => [key, schema.optional()])),
		}),
		output: NewsletterSchema,
		handler: async ({ account, input: { id, ...changes } }) =>
			saveNewsletter({ account, existing: await findNewsletter(account, id), changes }),
	}),
	defineAction({
		name: "list_themes",
		tryWithoutPlan: true,
		title: "List themes",
		group: GROUP,
		description:
			"Lists the theme presets a newsletter can take, with their colors, fonts and choices, and the options to change them with: fonts, heading weights, radius, shadow and spacing. update_newsletter's theme sets them.",
		http: { method: "GET", path: "/themes" },
		readOnly: true,
		output: z.object({
			presets: z.array(
				z.object({
					id: z.string(),
					name: z.string(),
					colors: z.object({ background: z.string(), text: z.string(), accent: z.string() }),
					fonts: z.object({ heading: z.string(), body: z.string() }),
					headingWeight: z.number().int(),
					radius: z.string(),
					shadow: z.string(),
					spacing: z.string(),
				})
			),
			fonts: z.array(
				z.object({
					id: z.string(),
					name: z.string(),
					category: z.enum(["sans", "serif", "mono"]),
					weights: z.array(z.number().int()).describe("The lightest and boldest weights it has"),
				})
			),
			headingWeights: z.array(z.number().int()),
			radius: z.array(z.string()),
			shadow: z.array(z.string()),
			spacing: z.array(z.string()),
		}),
		handler: async () => ({
			presets: THEME_PRESETS.map(({ tracking, ...preset }) => preset),
			fonts: THEME_FONTS.map(({ id, name, category, weights }) => ({ id, name, category, weights })),
			headingWeights: HEADING_WEIGHTS,
			radius: RADIUS_OPTIONS,
			shadow: SHADOW_OPTIONS,
			spacing: SPACING_OPTIONS,
		}),
	}),
	defineAction({
		name: "get_signup_form",
		tryWithoutPlan: true,
		title: "Get the signup form",
		group: GROUP,
		description:
			"Gets the signup form for a newsletter's own site: its settings and the code to paste there. script adds it in the newsletter's theme, in a frame that fits its content, right after its own tag: in React, Next.js, Vue or Svelte, where a script tag in a component doesn't stay where it sits, frame frameUrl instead and set its height from the { type: \"mailcheap:height\", height } messages it posts. html is a plain form that works without JavaScript and lands on a page that says what happened, null while sites are listed. Both post to endpoint, which takes an email from a browser on any site (CORS, JSON or form fields) while the form is on and follows the newsletter's confirmed opt-in and welcome email; from your own code, use add_contact with a signups-only key instead. update_newsletter's signupForm turns it on and sets its text and sites.",
		http: { method: "GET", path: "/newsletters/{id}/signup-form" },
		readOnly: true,
		input: z.object({ id: z.string().trim().min(1).max(100).describe("The newsletter's ID or slug") }),
		output: SignupFormSettings.extend({
			frameUrl: z.string().describe("The form on its own, as the script frames it"),
			endpoint: z
				.string()
				.describe("Where the form posts: email, first_name when the form asks for it, and the hidden website field left empty"),
			script: z.string().describe("The script tag to paste where the form goes"),
			html: z
				.string()
				.nullable()
				.describe("The plain HTML form, styled with the newsletter's theme. null while sites are listed: only the script works then"),
		}),
		handler: async ({ account, input }) => {
			const newsletter = await findNewsletter(account, input.id, { _id: 1, name: 1, description: 1, signupForm: 1, theme: 1 });
			const settings = toNewsletterSettings(newsletter).signupForm;
			const appUrl = getAppUrl();
			const paths = getSignupFormPaths(newsletter._id);
			return {
				...settings,
				frameUrl: `${appUrl}${paths.frame}`,
				endpoint: `${appUrl}${paths.endpoint}`,
				...getEmbedCode({ appUrl, newsletterId: newsletter._id, settings, theme: newsletter.theme, newsletter }),
			};
		},
	}),
	defineAction({
		name: "check_newsletter_slug",
		tryWithoutPlan: true,
		title: "Check a slug",
		group: GROUP,
		description: `Says whether a newsletter can take a slug: available, or taken by another newsletter, reserved by MailCheap or invalid, with the message saving it would answer. Checking doesn't count toward the ${SLUG_CHANGES.limit} slug changes ${formatWindow(SLUG_CHANGES.window)}.`,
		http: { method: "GET", path: "/newsletters/slugs/{slug}" },
		readOnly: true,
		rateLimit: { limit: 300, window: "1 h" },
		limitDashboard: true,
		example: { slug: "field-notes" },
		input: z.object({
			slug: z.string().trim().toLowerCase().max(100).describe("The slug to check"),
			id: z.string().trim().max(100).optional().describe("The newsletter that would take it, by ID or slug: its own slug is available to it"),
		}),
		output: z.object({
			slug: z.string(),
			available: z.boolean(),
			reason: z.enum(["taken", "reserved", "invalid"]).nullable().describe("Why it isn't available"),
			message: z.string().nullable(),
		}),
		handler: async ({ account, input }) => {
			const newsletter = input.id ? await findNewsletter(account, input.id, { _id: 1 }) : null;
			const problem =
				getSlugFormatProblem(input.slug) ?? ((await isSlugTaken(input.slug, newsletter?._id)) ? { reason: "taken", message: SLUG_TAKEN } : null);
			return { slug: input.slug, available: !problem, reason: problem?.reason ?? null, message: problem?.message ?? null };
		},
	}),
	defineAction({
		name: "send_welcome_test_email",
		title: "Send a test of the welcome email",
		group: GROUP,
		description: "Sends the saved welcome email to the account owner's address, switched on or not. It counts toward the plan's emails.",
		http: { method: "POST", path: "/newsletters/{id}/welcome-test" },
		openWorld: true,
		rateLimit: { limit: 20, window: "1 h" },
		input: z.object({ id: z.string().trim().min(1).max(100).describe("The newsletter's ID or slug") }),
		output: z.object({ sentTo: z.string(), messageId: z.string() }),
		handler: async ({ account, user, input }) => {
			assertSendingEnabled();
			const newsletter = await findNewsletter(account, input.id, { _id: 1 });
			const to = await findTestRecipient({ account, user });
			const { messageId } = await sendWelcomeTestEmail({ accountId: account._id, newsletterId: newsletter._id, to });
			return { sentTo: to, messageId };
		},
	}),
	defineAction({
		name: "set_website_domain",
		title: "Set the website's domain",
		group: GROUP,
		description:
			"Puts a newsletter's website, and the tracked and unsubscribe links in its next emails, on a subdomain of your own, like news.example.com. The answer lists the DNS records to add: a CNAME that points the subdomain at MailCheap, a TXT record that proves it's yours, and Vercel's own TXT record when the domain is used on Vercel. It goes live once check_website_domain finds them, and right away when they're already in. A newsletter has one domain at a time: remove a live one first.",
		http: { method: "POST", path: "/newsletters/{id}/website-domain" },
		idempotent: true,
		openWorld: true,
		rateLimit: { limit: 10, window: "1 h" },
		example: { host: "news.example.com" },
		input: z.object({
			id: z.string().trim().min(1).max(100).describe("The newsletter's ID or slug"),
			host: z.string().trim().max(253).describe("A subdomain of a domain you manage, like news.example.com. A link works too."),
		}),
		output: WebsiteDomainSchema,
		handler: async ({ account, input }) => {
			const newsletter = await setWebsiteDomain({ account, newsletter: await findNewsletter(account, input.id), host: input.host });
			return toWebsiteDomain(account, newsletter);
		},
	}),
	defineAction({
		name: "check_website_domain",
		title: "Check the website's domain",
		group: GROUP,
		description:
			"Looks up the DNS records of a newsletter's website domain again. One being set up goes live once they're all in: the website and the links in its next emails move there, and its address on the shared domain keeps working. For a live one, says whether its CNAME still points at MailCheap.",
		http: { method: "POST", path: "/newsletters/{id}/website-domain/check" },
		idempotent: true,
		openWorld: true,
		rateLimit: { limit: 60, window: "1 h" },
		input: z.object({ id: z.string().trim().min(1).max(100).describe("The newsletter's ID or slug") }),
		output: WebsiteDomainSchema,
		handler: async ({ account, input }) => {
			const newsletter = await checkWebsiteDomain({ account, newsletter: await findNewsletter(account, input.id) });
			return toWebsiteDomain(account, newsletter);
		},
	}),
	defineAction({
		name: "remove_website_domain",
		tryWithoutPlan: true,
		title: "Remove the website's domain",
		group: GROUP,
		description:
			"Takes a newsletter's website off its own domain: the website and the links in its next emails go back to its address on the shared domain. Links in the emails already sent on the domain keep working while it points at MailCheap.",
		http: { method: "DELETE", path: "/newsletters/{id}/website-domain" },
		destructive: true,
		idempotent: true,
		openWorld: true,
		input: z.object({ id: z.string().trim().min(1).max(100).describe("The newsletter's ID or slug") }),
		output: z.object({ removed: z.string().describe("The host the website was on") }),
		handler: async ({ account, input }) => removeWebsiteDomain({ account, newsletter: await findNewsletter(account, input.id) }),
	}),
];
