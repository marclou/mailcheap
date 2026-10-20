import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";

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
		// The account's verified archive subdomain (lib/domains.js syncArchiveHosts). Without one, the
		// archive and the links in its emails use <slug>.<shared domain>.
		archiveHost: { type: String, lowercase: true, trim: true },
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
		description: { type: String, trim: true },
		socialLinks: [{ type: String, trim: true }],
		// The archive's author page; the author's name is fromName.
		author: {
			bio: { type: String, trim: true },
			imageUrl: { type: String, trim: true },
		},
		// New signups get an email with a link and only join once they click it (confirmed opt-in).
		requireConfirmation: { type: Boolean, default: false },
		// Checked when an issue is sent (lib/cleanup.js). Empty numbers use the newsletter's defaults.
		cleanup: {
			enabled: { type: Boolean, default: false },
			issues: { type: Number, min: 1 },
			days: { type: Number, min: 1 },
		},
		welcome: {
			enabled: { type: Boolean, default: false },
			subject: { type: String, trim: true },
			previewText: { type: String, trim: true },
			markdown: { type: String },
		},
		// The newsletter's own confirmation email; the built-in one goes out until it has one.
		confirmation: {
			subject: { type: String, trim: true },
			previewText: { type: String, trim: true },
			markdown: { type: String },
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
