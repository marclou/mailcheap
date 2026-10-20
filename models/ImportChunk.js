import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";

// A piece of an import waiting for the background job (lib/import-jobs.js): its rows as the caller sent them, checked
// again when processed. A processed chunk keeps only its count, and every chunk expires after a week, so a file's
// people don't stay here once they're contacts.
const importChunkSchema = new mongoose.Schema(
	{
		importId: { type: mongoose.Schema.Types.ObjectId, ref: "ContactImport", required: true },
		index: { type: Number, required: true, min: 0 },
		rows: { type: [mongoose.Schema.Types.Mixed], default: undefined },
		count: { type: Number, required: true, min: 0 },
		processedAt: { type: Date },
	},
	{ timestamps: { createdAt: true, updatedAt: false } }
);

importChunkSchema.plugin(accountScoped);
importChunkSchema.index({ importId: 1, index: 1 }, { unique: true });
importChunkSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export default mongoose.models.ImportChunk || mongoose.model("ImportChunk", importChunkSchema);
