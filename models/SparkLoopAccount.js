import mongoose from "mongoose";

// The one SparkLoop account this install is connected to. The API key is sealed with lib/secret-box.js.
const sparkLoopAccountSchema = new mongoose.Schema(
	{
		singleton: { type: String, default: "sparkloop", unique: true },
		apiKey: { type: String, required: true },
		// The key's last characters, so the settings can show which one is in use.
		apiKeyHint: { type: String },
		// The webhook SparkLoop sends referred readers to, and the SHA-256 of its URL's token
		// (lib/sparkloop-referrals.js).
		webhookUuid: { type: String },
		webhookTokenHash: { type: String },
	},
	{ timestamps: true }
);

export default mongoose.models.SparkLoopAccount || mongoose.model("SparkLoopAccount", sparkLoopAccountSchema);
