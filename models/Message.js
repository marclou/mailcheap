import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";

// held: a first send's never-mailed contacts past the first slice, queued once that slice checks out. skipped: a
// welcome email the month's emails had no room for (lib/sending.js), never sent later.
export const MESSAGE_STATUSES = [
	"held",
	"queued",
	"sent",
	"delivered",
	"bounced",
	"complained",
	"failed",
	"suppressed",
	"skipped",
];

const messageSchema = new mongoose.Schema(
	{
		kind: { type: String, enum: ["campaign", "last-chance", "welcome", "confirmation", "test"], required: true },
		campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign" },
		newsletterId: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true },
		contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact" },
		email: { type: String, required: true, lowercase: true, trim: true },
		provider: { type: String },
		status: { type: String, enum: MESSAGE_STATUSES, default: "queued" },
		// The contact had never received an email from this account (lib/first-send.js).
		firstSend: { type: Boolean },
		// A Gmail reader a new domain sends on a later day: not before then (lib/sending.js markSendAfter).
		sendAfter: { type: Date },
		// The email provider's id for it, when the send returns one; else the first event fills it in.
		providerMessageId: { type: String },
		error: { type: String },
		sentAt: Date,
		deliveredAt: Date,
		openedAt: Date,
		clickedAt: Date,
		// The links its reader clicked, by lib/link-stats.js key, so each counts them once (models/CampaignLink.js).
		clickedLinks: { type: [String], default: undefined },
		bouncedAt: Date,
		complainedAt: Date,
		// Gmail refused it as likely unsolicited (lib/email-event-rules.js): it stays sent, and counts against its send.
		refusedAt: Date,
		// They unsubscribed through it: the latest issue they got, for an unsubscribe link or their mail app's button
		// (app/api/unsubscribe), or the email the provider's own unsubscribe names (lib/email-events.js).
		unsubscribedAt: Date,
	},
	{ timestamps: true }
);

messageSchema.plugin(accountScoped);
// One email per contact per campaign, even if a send job is retried.
messageSchema.index(
	{ campaignId: 1, contactId: 1 },
	{ unique: true, partialFilterExpression: { kind: "campaign" } }
);
// And at most one last-chance email per contact per send.
messageSchema.index(
	{ campaignId: 1, contactId: 1, kind: 1 },
	{ unique: true, partialFilterExpression: { kind: "last-chance" } }
);
messageSchema.index({ providerMessageId: 1 }, { sparse: true });
// A contact's emails, newest first (lib/contact-emails.js), and the checks on its welcome and confirmation emails.
messageSchema.index({ contactId: 1, _id: -1 });
messageSchema.index({ kind: 1, createdAt: -1 });
// The overview's emails sent per hour.
messageSchema.index({ newsletterId: 1, sentAt: 1 });
// A newsletter's welcome emails over the overview's period, up to two years, without reading every account's.
messageSchema.index({ newsletterId: 1, createdAt: 1 }, { partialFilterExpression: { kind: "welcome" } });
messageSchema.index({ campaignId: 1, status: 1 });
// Emails still waiting to go out, which the plan check counts before a new send.
messageSchema.index({ accountId: 1, campaignId: 1 }, { partialFilterExpression: { status: "queued" } });
// The account-level check on the last days of sends (lib/account-health.js).
messageSchema.index({ accountId: 1, sentAt: -1 });
// The addresses outside the team an account's tests reached in the last day (lib/test-recipients.js).
messageSchema.index({ accountId: 1, createdAt: -1 }, { partialFilterExpression: { kind: "test" } });

export default mongoose.models.Message || mongoose.model("Message", messageSchema);
