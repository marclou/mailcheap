import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";
import { contentReviewSchema } from "../lib/content-review-schema.js";
import { SUMMARY_FREQUENCIES } from "../lib/summary.js";

const newsletterSchema = new mongoose.Schema(
	{
		name: { type: String, required: true, trim: true },
		// Unique across accounts: the archive lives at /archive/<slug>.
		slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
		imageUrl: { type: String, trim: true },
		fromName: { type: String, trim: true },
		fromEmail: { type: String, required: true, lowercase: true, trim: true },
		replyTo: { type: String, lowercase: true, trim: true },
		// Without one, emails print the server's default (lib/postal-address.js), unless the owner saved it empty.
		postalAddress: { type: String, trim: true },
		postalAddressCleared: { type: Boolean },
		archiveEnabled: { type: Boolean, default: false },
		// Its website domain's host once it's live (lib/website-domains.js). Without one, the archive and the links in its
		// emails use <slug>.<shared domain>.
		archiveHost: { type: String, lowercase: true, trim: true },
		// Its own domain for its website and the links in its emails, as last checked.
		websiteDomain: {
			host: { type: String, lowercase: true, trim: true },
			cnameFound: { type: Boolean },
			// The TXT record that proves the account controls the host (lib/website-domain-rules.js).
			txtFound: { type: Boolean },
			// The TXT records Vercel asks for when the domain is verified for another Vercel team.
			verification: { type: [{ _id: false, type: { type: String }, name: String, value: String }], default: undefined },
			// On the app's Vercel project, through the DNS helper.
			attachedAt: { type: Date },
			checkedAt: { type: Date },
			liveAt: { type: Date },
		},
		// Hosts its website was live on before. They stay on the app's Vercel project, so the links in the emails sent
		// then keep working, until the account is purged.
		pastHosts: { type: [String], default: undefined },
		// The shared address's sending domain, <slug>.<shared domain>, in the account's tenant at the email
		// provider, with the DNS records MailCheap published for it on the shared domain (lib/shared-sender.js).
		sharedSender: {
			domain: { type: String, lowercase: true, trim: true },
			provider: { type: String },
			providerDomainId: { type: String },
			verified: { type: Boolean },
			dnsRecordIds: { type: [String], default: undefined },
			createdAt: { type: Date },
			checkedAt: { type: Date },
			verifiedAt: { type: Date },
		},
		// The domain it last sent a campaign from, whose warm-up its sends follow (models/SenderDomain.js).
		sendingDomain: { type: String, lowercase: true, trim: true },
		description: { type: String, trim: true },
		socialLinks: [{ type: String, trim: true }],
		// The archive's author page; the author's name is fromName.
		author: {
			bio: { type: String, trim: true },
			imageUrl: { type: String, trim: true },
		},
		// The analytics tools its website loads, each by its ID alone (lib/website-analytics.js).
		analytics: {
			googleAnalytics: { type: String, trim: true },
			googleTagManager: { type: String, trim: true },
			metaPixel: { type: String, trim: true },
		},
		// Its own HTML for the head of its website's pages, only ever sent on its own domain (lib/website-code.js).
		customCode: { type: String },
		// New signups get an email with a link and only join once they click it (confirmed opt-in).
		requireConfirmation: { type: Boolean, default: false },
		// Checked when an issue is sent (lib/cleanup.js). Empty numbers use the newsletter's defaults.
		cleanup: {
			enabled: { type: Boolean, default: false },
			issues: { type: Number, min: 1 },
			days: { type: Number, min: 1 },
		},
		// Its own emails (lib/newsletter-emails.js), each written in the editor (format rich, in html) or in Markdown, as
		// they were before it and as the API takes them.
		welcome: {
			enabled: { type: Boolean, default: false },
			subject: { type: String, trim: true },
			previewText: { type: String, trim: true },
			format: { type: String, enum: ["markdown", "rich"] },
			markdown: { type: String },
			html: { type: String },
		},
		// The newsletter's own confirmation email; the built-in one goes out until it has one.
		confirmation: {
			subject: { type: String, trim: true },
			previewText: { type: String, trim: true },
			format: { type: String, enum: ["markdown", "rich"] },
			markdown: { type: String },
			html: { type: String },
		},
		// The newsletter's own last-chance email for its list cleanup (lib/last-chance-content.js); the built-in one goes out
		// until it has one.
		lastChance: {
			subject: { type: String, trim: true },
			previewText: { type: String, trim: true },
			format: { type: String, enum: ["markdown", "rich"] },
			markdown: { type: String },
			html: { type: String },
		},
		// The content check of its own welcome, confirmation and last-chance emails (lib/signup-email-review.js), each of the
		// content it read. Apart from the emails, which a save replaces whole.
		reviews: {
			type: new mongoose.Schema(
				{ welcome: contentReviewSchema, confirmation: contentReviewSchema, lastChance: contentReviewSchema },
				{ _id: false }
			),
			select: false,
		},
		// The signup form its owner pastes on their own site (lib/signup-form.js), off until they turn it on. No domains:
		// any site can hold it.
		signupForm: {
			enabled: { type: Boolean, default: false },
			layout: { type: String },
			// The card's text above the form: unset follows the newsletter's name and description, empty hides it.
			headline: { type: String, trim: true },
			subheadline: { type: String, trim: true },
			askFirstName: { type: Boolean },
			buttonText: { type: String, trim: true },
			placeholder: { type: String, trim: true },
			allowedDomains: { type: [String], default: undefined },
		},
		// Dashboard helpers its owner closed: ownDomain, the step the own-domain helper suggested (lib/sender-rules.js), and
		// inboxCheck, when the settings card about getting MailCheap's emails in their inbox went (lib/inbox-check.js).
		dismissedNudges: {
			ownDomain: { type: String },
			inboxCheck: { type: Date },
		},
		// What MailCheap emails its owner about it, a choice for each kind: summary, how often its summary email comes
		// (lib/summary.js), weekly while unset.
		notifications: {
			summary: { type: String, enum: SUMMARY_FREQUENCIES },
		},
		// The last summary email claimed, which a second delivery of its job doesn't send again (lib/summary-send.js).
		// Apart from notifications, which a save of the settings replaces whole.
		summarySent: {
			key: { type: String },
			at: { type: Date },
		},
		// Its get-started panel (lib/get-started.js), closed by its owner or finished: either hides it for good, on every
		// device. The account's other newsletters keep theirs. themeChosenAt: a theme preset picked, MailCheap's own
		// included, which does the panel's design step.
		getStarted: {
			dismissedAt: { type: Date },
			finishedAt: { type: Date },
			themeChosenAt: { type: Date },
		},
		// Its look on its website and in its emails (lib/themes.js): a preset, and only what was changed on top of it.
		theme: {
			preset: { type: String, trim: true },
			colors: { background: { type: String }, text: { type: String }, accent: { type: String } },
			fonts: { heading: { type: String }, body: { type: String } },
			headingWeight: { type: Number },
			radius: { type: String },
			shadow: { type: String },
			spacing: { type: String },
		},
	},
	{ timestamps: true }
);

newsletterSchema.plugin(accountScoped);
newsletterSchema.index({ accountId: 1, createdAt: 1 });
newsletterSchema.index({ archiveHost: 1 }, { unique: true, partialFilterExpression: { archiveHost: { $type: "string" } } });

export default mongoose.models.Newsletter || mongoose.model("Newsletter", newsletterSchema);
