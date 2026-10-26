import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";
import { contentReviewSchema } from "../lib/content-review-schema.js";
import { PUBLISH_TARGETS } from "../lib/publish-to.js";

export const CAMPAIGN_STATUSES = ["draft", "scheduled", "sending", "paused", "sent", "canceled"];
export const CAMPAIGN_CHANNELS = ["email", "sms"];

const counter = { type: Number, default: 0 };

const campaignSchema = new mongoose.Schema(
	{
		newsletterId: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true },
		subject: { type: String, trim: true, default: "" },
		previewText: { type: String, trim: true, default: "" },
		// rich: written in the editor, stored as an HTML fragment in html. html: a designed document sent
		// as is. markdown: older drafts and API campaigns.
		format: { type: String, enum: ["markdown", "html", "rich"], default: "rich" },
		markdown: { type: String, default: "" },
		html: { type: String, default: "" },
		status: { type: String, enum: CAMPAIGN_STATUSES, default: "draft" },
		channel: { type: String, enum: CAMPAIGN_CHANNELS, default: "email", index: true },
		smsText: { type: String, default: "", trim: true },
		smsSegments: { type: Number, default: 1, min: 1 },
		smsEncoding: { type: String, enum: ["GSM-7", "UCS-2"], default: "GSM-7" },
		// By email and on the website, by email only, or on the website only (lib/publish-to.js). Web only sends nothing:
		// it goes straight to sent, with no messages.
		publishTo: { type: String, enum: PUBLISH_TARGETS, default: "both" },
		// Why a send paused itself; a code from lib/account-state.js when the account or plan stopped it.
		pauseReason: { type: String },
		pauseCode: { type: String },
		// Its owner resumed it from a pause for its bounce or complaint rates: from then on, only the block level
		// stops it (lib/rate-levels.js).
		ratesAcceptedAt: { type: Date },
		// Warm-up: send to the most engaged contacts first, capped at audienceLimit.
		audienceLimit: { type: Number, min: 1 },
		// Only this segment's active contacts get it, its conditions read at each send (lib/segments.js). Without one,
		// every active contact does.
		segmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Segment" },
		// Contacts never mailed before go out in steps (lib/first-send.js): how many each step sends, the last the rest,
		// the step out so far, the first's size, how many still wait, when the next check is, and when the last one passed.
		// Sends from before had a single slice, and restHours in a spread send.
		firstSend: {
			steps: { type: [Number], default: undefined },
			step: { type: Number },
			slice: { type: Number },
			held: { type: Number },
			checkAt: { type: Date },
			checkedAt: { type: Date },
			restHours: { type: Number },
		},
		source: { type: String, default: "dashboard" },
		scheduledAt: { type: Date },
		startedAt: { type: Date },
		// A send that doesn't go out at once: about when its last email goes, its first-send steps' checks or a new
		// domain's later day for Gmail included (lib/sending.js). spreadHours: the hours sends from before were spread over.
		sendingUntil: { type: Date },
		spreadHours: { type: Number },
		sentAt: { type: Date },
		// When its latest step finished going out.
		finishedAt: { type: Date },
		testSentAt: { type: Date },
		archiveSlug: { type: String, trim: true, lowercase: true },
		thumbnailUrl: { type: String, trim: true },
		// Unlisted issues keep their /p/slug page but stay off the archive index.
		archiveListed: { type: Boolean, default: true },
		// Pinned issues sit in the Featured row at the top of the archive.
		archivePinned: { type: Boolean, default: false },
		// Archive page views, once per browser and day.
		webViews: { type: Number, default: 0 },
		// The content check before a send, of the content it read.
		review: { type: contentReviewSchema, select: false },
		// The same check at the review step, before any send: a send of the content it read uses it as its own.
		draftReview: { type: contentReviewSchema, select: false },
		stats: {
			recipients: counter,
			sent: counter,
			delivered: counter,
			bounced: counter,
			complained: counter,
			opened: counter,
			clicked: counter,
			unsubscribed: counter,
			failed: counter,
		},
		// Clicks per link (models/CampaignLink.js): contacts who clicked at least one, and when the send started being counted
		// per link. Counted from its start, it has every click; one that started earlier only has the clicks since.
		links: {
			clickers: counter,
			countedAt: { type: Date },
		},
		// The list cleanup at this send: last-chance emails sent instead of the issue, and contacts made dormant.
		lastChance: {
			recipients: counter,
			sent: counter,
			delivered: counter,
			bounced: counter,
			complained: counter,
			failed: counter,
			dormant: counter,
		},
	},
	{ timestamps: true }
);

campaignSchema.plugin(accountScoped);
campaignSchema.index({ newsletterId: 1, createdAt: -1 });
campaignSchema.index({ accountId: 1, status: 1 });
campaignSchema.index({ newsletterId: 1, startedAt: -1 });
// Unique across accounts: /p/<slug> on the app's domain finds an issue by its slug alone.
campaignSchema.index(
	{ archiveSlug: 1 },
	{ unique: true, partialFilterExpression: { archiveSlug: { $type: "string" } } }
);

export default mongoose.models.Campaign || mongoose.model("Campaign", campaignSchema);
