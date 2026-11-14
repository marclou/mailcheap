import mongoose from "mongoose";

// One per email a Google Workspace mailbox sent (lib/email-provider/workspace.js), MailCheap's own included, kept for
// the 24 hours Google counts its limit over. Nothing in it names an account or an address.
const mailboxSendSchema = new mongoose.Schema({
	at: { type: Date, required: true, default: Date.now },
});

mailboxSendSchema.index({ at: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export default mongoose.models.MailboxSend || mongoose.model("MailboxSend", mailboxSendSchema);
