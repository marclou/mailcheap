import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";

const counter = { type: Number, default: 0 };

// processing while rows wait for the background job or the rest of the file, done, or failed (error says why).
// Imports from before background jobs have no status: they ran while the browser waited, so they're done.
export const IMPORT_STATUSES = ["processing", "done", "failed"];

// One CSV import, with the customer's word that these people agreed to their emails. Its rows arrive in chunks
// (ImportChunk) that a background job processes in order (lib/import-jobs.js).
const contactImportSchema = new mongoose.Schema(
	{
		newsletterId: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true },
		userId: { type: mongoose.Schema.Types.ObjectId },
		// The API key that gave the consent, for imports through the API or MCP.
		apiKeyId: { type: mongoose.Schema.Types.ObjectId },
		source: { type: String, default: "dashboard" },
		consent: { type: Boolean, required: true },
		consentText: { type: String, required: true },
		consentAt: { type: Date, required: true },
		status: { type: String, enum: IMPORT_STATUSES },
		fileName: { type: String, trim: true, maxlength: 200 },
		// The rows the whole import sends, when the caller says (the dashboard does): it's done once they're all in.
		total: { type: Number, min: 0 },
		received: counter,
		chunks: counter,
		// The chunk the job processes next, and until when a run holds it.
		nextChunk: counter,
		lockedUntil: { type: Date },
		attempts: counter,
		// When a look at the import last started its waiting chunk again (lib/import-jobs.js mend).
		resumedAt: { type: Date },
		startedAt: { type: Date },
		finishedAt: { type: Date },
		error: { type: String, maxlength: 300 },
		// Rows processed.
		rows: counter,
		created: counter,
		existing: counter,
		dropped: {
			invalid: counter,
			typo: counter,
			trap: counter,
			role: counter,
			disposable: counter,
			duplicate: counter,
			suppressed: counter,
			undeliverable: counter,
			noMail: counter,
		},
	},
	{ timestamps: true }
);

contactImportSchema.plugin(accountScoped);
contactImportSchema.index({ accountId: 1, createdAt: -1 });
contactImportSchema.index({ accountId: 1, newsletterId: 1, createdAt: -1 });

export default mongoose.models.ContactImport || mongoose.model("ContactImport", contactImportSchema);
