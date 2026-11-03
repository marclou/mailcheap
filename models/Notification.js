import mongoose from "mongoose";
import { accountScoped } from "../lib/account-scope.js";

// What the dashboard's bell shows an account (lib/notifications.js). One per key: the same thing happening again
// brings its notification back on top, unread, instead of adding another. kind: what it's about (lib/notification-rules.js).
// path: the dashboard page it's about. at: when it last happened. readAt: when the tray showed it. clearedAt: when its
// owner cleared it, which hides it until the same thing happens again.
const notificationSchema = new mongoose.Schema(
	{
		key: { type: String, required: true, maxlength: 200 },
		kind: { type: String, required: true, maxlength: 60 },
		title: { type: String, required: true, maxlength: 200 },
		body: { type: String, maxlength: 1000 },
		path: { type: String, maxlength: 500 },
		// A website it's about, whose favicon the tray shows.
		domain: { type: String, maxlength: 253 },
		at: { type: Date, required: true },
		readAt: { type: Date },
		clearedAt: { type: Date },
	},
	{ timestamps: true }
);

notificationSchema.plugin(accountScoped);
notificationSchema.index({ accountId: 1, key: 1 }, { unique: true });
notificationSchema.index({ accountId: 1, at: -1, _id: -1 });
notificationSchema.index({ accountId: 1, readAt: 1 });
notificationSchema.index({ at: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.models.Notification || mongoose.model("Notification", notificationSchema);
