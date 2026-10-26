import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";

// Per account: an address that bounced or complained is never emailed again from any of its newsletters.
// provider: the email provider refused it for the account, for a reason it recorded on its side.
const suppressionSchema = new mongoose.Schema(
	{
		targetType: { type: String, enum: ["email", "phone"], default: "email", index: true },
		email: { type: String, lowercase: true, trim: true },
		phone: { type: String, trim: true, index: true },
		reason: { type: String, enum: ["bounce", "complaint", "manual", "provider", "stop"], required: true },
		detail: { type: String },
	},
	{ timestamps: true }
);

suppressionSchema.plugin(accountScoped);
suppressionSchema.index(
	{ accountId: 1, email: 1 },
	{ unique: true, partialFilterExpression: { email: { $type: "string" } } }
);
suppressionSchema.index(
	{ accountId: 1, phone: 1 },
	{ unique: true, partialFilterExpression: { phone: { $type: "string" } } }
);
suppressionSchema.index({ accountId: 1, createdAt: -1 });

export default mongoose.models.Suppression || mongoose.model("Suppression", suppressionSchema);
