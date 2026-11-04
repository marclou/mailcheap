import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";
import { TEAM_ROLES } from "../lib/team-rules.js";

// Someone the account's owner invited to work on one of its newsletters, with a role on it (lib/team-rules.js). One per
// newsletter and address: inviting a removed one again starts it over.
const teamMemberSchema = new mongoose.Schema(
	{
		newsletterId: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true, immutable: true },
		name: { type: String, required: true, trim: true },
		email: { type: String, required: true, lowercase: true, trim: true },
		role: { type: String, enum: TEAM_ROLES, required: true },
		// The owner's user who sent the invitation last, and when.
		invitedBy: { type: mongoose.Schema.Types.ObjectId },
		invitedAt: { type: Date },
		// The invitation link's token, hashed like an API key, until it's accepted or the member is removed.
		tokenHash: { type: String },
		expiresAt: { type: Date },
		// The user who accepted, signed in with the address it went to: the dashboard opens the newsletter for them.
		userId: { type: mongoose.Schema.Types.ObjectId },
		joinedAt: { type: Date },
		// Removed by the owner, or gone with their own account: no access, and the address can be invited again.
		removedAt: { type: Date },
		// Where their test emails go when they don't name addresses (lib/test-recipients.js): without, their own address.
		testRecipients: { type: [String], default: undefined },
	},
	{ timestamps: true }
);

teamMemberSchema.plugin(accountScoped);
teamMemberSchema.index({ newsletterId: 1, email: 1 }, { unique: true });
teamMemberSchema.index({ accountId: 1, newsletterId: 1, createdAt: 1 });
teamMemberSchema.index({ userId: 1 }, { partialFilterExpression: { userId: { $type: "objectId" } } });
teamMemberSchema.index({ tokenHash: 1 }, { unique: true, partialFilterExpression: { tokenHash: { $type: "string" } } });

export default mongoose.models.TeamMember || mongoose.model("TeamMember", teamMemberSchema);
