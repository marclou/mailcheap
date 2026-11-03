import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";

// The views an issue's page on its newsletter's website got in one hour, counted like Campaign.webViews, once per
// reader a day (app/api/views). hour: when it started, in UTC. The report adds them up by day in its reader's timezone
// (lib/page-views.js).
const pageViewSchema = new mongoose.Schema({
	campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
	hour: { type: Date, required: true },
	views: { type: Number, default: 0 },
});

pageViewSchema.plugin(accountScoped);
// A view upserts its hour by these, and a report reads a campaign's hours by the first two.
pageViewSchema.index({ accountId: 1, campaignId: 1, hour: 1 }, { unique: true });

export default mongoose.models.PageView || mongoose.model("PageView", pageViewSchema);
