import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";

// One link of a sent campaign, as lib/link-stats.js normalizes it, and its clicks: every one that counts, and the
// contacts who clicked it at least once. Link scanners' visits and the unsubscribe link never count.
const campaignLinkSchema = new mongoose.Schema(
	{
		campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
		key: { type: String, required: true },
		url: { type: String, required: true },
		clicks: { type: Number, default: 0 },
		clickers: { type: Number, default: 0 },
	},
	{ timestamps: true }
);

campaignLinkSchema.plugin(accountScoped);
// The click upserts its link by these, and a report reads a campaign's links by the first two.
campaignLinkSchema.index({ accountId: 1, campaignId: 1, key: 1 }, { unique: true });

export default mongoose.models.CampaignLink || mongoose.model("CampaignLink", campaignLinkSchema);
