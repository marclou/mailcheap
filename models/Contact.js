import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";
import { AUDIENCE_SORT } from "../lib/audience.js";

// pending: signed up to a newsletter that asks new subscribers to confirm, and hasn't yet.
export const CONTACT_STATUSES = ["active", "pending", "unsubscribed", "bounced", "complained", "dormant"];
export const SMS_STATUSES = ["none", "active", "unsubscribed", "bounced"];

const contactSchema = new mongoose.Schema(
	{
		newsletterId: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true },
		email: { type: String, required: true, lowercase: true, trim: true },
		status: { type: String, enum: CONTACT_STATUSES, default: "active" },
		source: { type: String, trim: true },
		// Signed up with the form on the owner's site (source "embed"): that site's host, as the browser named it.
		sourceDomain: { type: String, trim: true },
		// Where the person was, as a two-letter code (lib/countries.js): from the signup that added them, their confirmation, or
		// else their first click in an email.
		country: { type: String },
		// What {{first_name}} prints in its emails (lib/merge-tags.js).
		firstName: { type: String, trim: true },
		// Values for the account's own fields (Account.contactFields), by key: text, a number or a date (lib/contact-fields.js).
		fields: { type: mongoose.Schema.Types.Mixed },
		// International E.164 phone number, e.g. "+33612345678"
		phone: { type: String, trim: true, index: true },
		phoneCountry: { type: String, trim: true },
		smsStatus: { type: String, enum: SMS_STATUSES, default: "none", index: true },
		smsConsent: {
			userId: { type: mongoose.Schema.Types.ObjectId },
			source: { type: String, trim: true },
			at: { type: Date },
		},
		smsSubscribedAt: { type: Date },
		smsUnsubscribedAt: { type: Date },
		lastSmsSentAt: { type: Date },
		lastSmsClickAt: { type: Date },
		// Lowercase labels, many per contact, for segments and the contacts list.
		tags: { type: [String], default: undefined },
		importId: { type: mongoose.Schema.Types.ObjectId, ref: "ContactImport" },
		// Added by hand on the dashboard: the user who said this person agreed to get the newsletter, and when.
		consent: {
			userId: { type: mongoose.Schema.Types.ObjectId },
			at: { type: Date },
		},
		subscribedAt: { type: Date, default: Date.now },
		confirmedAt: { type: Date },
		unsubscribedAt: { type: Date },
		lastSentAt: { type: Date },
		lastOpenAt: { type: Date },
		lastClickAt: { type: Date },
		// List cleanup (lib/cleanup.js): issues received since the last sign of life (open, click,
		// confirmation, signup, "keep sending it" click), when that was, and when the last-chance email went out.
		ignoredIssues: { type: Number },
		lastEngagedAt: { type: Date },
		lastChanceAt: { type: Date },
		// Bounced without a send of this account: a send skipped it, on the never-email list (lib/global-suppressions.js),
		// or the list hygiene stopped it (lib/list-hygiene.js), which sets undeliverableReason and the status it had.
		undeliverableAt: { type: Date },
		undeliverableReason: { type: String, enum: ["no-mail-server", "spam-domain"] },
		undeliverableFrom: { type: String },
		// Every change of its status, whatever made it (lib/status-changes.js), oldest first. Changes by hand or through the
		// API and MCP keep who made them and whether they came with the person's consent; a signup again keeps its source,
		// and the list hygiene its reason.
		statusChanges: {
			type: [
				{
					_id: false,
					from: { type: String },
					to: { type: String },
					at: { type: Date },
					via: { type: String },
					userId: { type: mongoose.Schema.Types.ObjectId },
					apiKeyId: { type: mongoose.Schema.Types.ObjectId },
					connectionId: { type: String },
					consent: { type: Boolean },
					source: { type: String },
					reason: { type: String },
				},
			],
			default: undefined,
		},
		stats: {
			sent: { type: Number, default: 0 },
			opens: { type: Number, default: 0 },
			clicks: { type: Number, default: 0 },
		},
		// From a CSV import: engagement on the previous platform, so sends reach the most engaged first.
		imported: {
			emailsReceived: { type: Number },
			openRate: { type: Number },
			clickRate: { type: Number },
		},
	},
	{ timestamps: true }
);

contactSchema.plugin(accountScoped);
contactSchema.index({ newsletterId: 1, email: 1 }, { unique: true });
contactSchema.index({ newsletterId: 1, smsStatus: 1, phone: 1 });
contactSchema.index({ newsletterId: 1, status: 1, createdAt: -1 });
// Bounces and complaints change every contact with the address in the account.
contactSchema.index({ accountId: 1, email: 1 });
// The contacts list shows the newest subscribers first, with or without newsletter and status filters.
// It breaks ties by _id, which the index needs too: without it MongoDB sorts the whole list on every page.
contactSchema.index({ accountId: 1, subscribedAt: -1, _id: -1 });
contactSchema.index({ accountId: 1, status: 1, subscribedAt: -1, _id: -1 });
contactSchema.index({ newsletterId: 1, subscribedAt: -1, _id: -1 });
contactSchema.index({ newsletterId: 1, status: 1, subscribedAt: -1, _id: -1 });
// Segments on opens (lib/segments.js) read a range of it instead of every active contact of a large list.
contactSchema.index({ newsletterId: 1, status: 1, lastOpenAt: -1 });
// A send reads its audience in this order, most engaged first (lib/audience.js). Without it MongoDB sorts the whole list
// in memory, and a send to a list past its 32 MB limit fails.
contactSchema.index({ newsletterId: 1, status: 1, ...AUDIENCE_SORT });
// A tag's contacts, newest first, for the list's tag filter and segments on tags, and the newsletter's tags.
contactSchema.index({ newsletterId: 1, tags: 1, subscribedAt: -1, _id: -1 });
// The same for a source, and the newsletter's sources.
contactSchema.index({ newsletterId: 1, source: 1, subscribedAt: -1, _id: -1 });
// The list cleanup totals in newsletter settings.
contactSchema.index({ newsletterId: 1, lastChanceAt: 1 }, { partialFilterExpression: { lastChanceAt: { $exists: true } } });
// An admin taking an address off the never-email list finds the contacts it stopped, in every account.
contactSchema.index({ email: 1 }, { partialFilterExpression: { undeliverableAt: { $exists: true } } });

export default mongoose.models.Contact || mongoose.model("Contact", contactSchema);
