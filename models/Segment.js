import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";
import { SEGMENT_MATCHES, SEGMENT_OPS, isSegmentFieldName } from "../lib/segments.js";

// Conditions that pick some of a newsletter's contacts, as lib/segments.js checked them. A deleted segment is kept with
// deletedAt, like every customer document: campaigns that went to it still point at it.
const segmentSchema = new mongoose.Schema(
	{
		newsletterId: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true },
		name: { type: String, required: true, trim: true },
		match: { type: String, enum: SEGMENT_MATCHES, default: "all" },
		conditions: [
			{
				_id: false,
				// A built-in field, or fields.<key> for one of the account's own (Account.contactFields).
				field: { type: String, required: true, validate: { validator: isSegmentFieldName, message: "Unknown field {VALUE}" } },
				op: { type: String, enum: SEGMENT_OPS, required: true },
				value: { type: mongoose.Schema.Types.Mixed },
			},
		],
		deletedAt: { type: Date },
	},
	{ timestamps: true }
);

segmentSchema.plugin(accountScoped);
segmentSchema.index({ accountId: 1, newsletterId: 1, createdAt: 1 });

export default mongoose.models.Segment || mongoose.model("Segment", segmentSchema);
