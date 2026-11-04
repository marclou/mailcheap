import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";

// Who writes a newsletter's issues (Campaign.authorId): the name and picture their emails and pages show, where they
// show them, and the address replies to their issues go to, which neither ever shows. A removed author is kept with
// deletedAt, like every customer document, and shows nowhere.
const authorSchema = new mongoose.Schema(
	{
		newsletterId: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true, immutable: true },
		name: { type: String, required: true, trim: true },
		email: { type: String, required: true, trim: true, lowercase: true },
		imageUrl: { type: String },
		showOnWeb: { type: Boolean, default: true },
		showInEmails: { type: Boolean, default: true },
		deletedAt: { type: Date },
	},
	{ timestamps: true }
);

authorSchema.plugin(accountScoped);
authorSchema.index({ accountId: 1, newsletterId: 1, createdAt: 1 });

export default mongoose.models.Author || mongoose.model("Author", authorSchema);
