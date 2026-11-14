import mongoose from "mongoose";

// How far the bounce reader got in a Google Workspace mailbox (lib/workspace-bounces.js): the last UID it read in All
// Mail, valid while the folder's UIDVALIDITY stays the same.
const mailboxCursorSchema = new mongoose.Schema(
	{
		_id: { type: String },
		uidValidity: { type: String },
		lastUid: { type: Number, default: 0 },
	},
	{ timestamps: true }
);

export default mongoose.models.MailboxCursor || mongoose.model("MailboxCursor", mailboxCursorSchema);
