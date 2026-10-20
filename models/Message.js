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
messageSchema.index({ kind: 1, createdAt: -1 });
// The overview's emails sent per hour.
messageSchema.index({ newsletterId: 1, sentAt: 1 });
messageSchema.index({ campaignId: 1, status: 1 });
// Emails still waiting to go out, which the plan check counts before a new send.
messageSchema.index({ accountId: 1, campaignId: 1 }, { partialFilterExpression: { status: "queued" } });
// The account-level check on the last days of sends (lib/account-health.js).
messageSchema.index({ accountId: 1, sentAt: -1 });

export default mongoose.models.Message || mongoose.model("Message", messageSchema);
