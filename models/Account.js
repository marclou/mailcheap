import mongoose from "mongoose";
import { FIELD_TYPE_IDS } from "../lib/contact-fields.js";
import { INTERVALS, PLAN_IDS } from "../lib/plans.js";

export const ACCOUNT_STATUSES = ["active", "paused"];
export const BLOCK_SOURCES = ["admin", "rates", "campaign", "slice", "trap", "ses", "postshiba", "groundmail", "gmail"];

const accountSchema = new mongoose.Schema(
	{
		// The Better Auth user who signed up. One user per account at launch.
		ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
		// Written by the Stripe webhook (lib/billing.js) and the checkout return, never from a form.
		plan: { type: String, enum: PLAN_IDS },
		interval: { type: String, enum: INTERVALS },
		stripeCustomerId: { type: String },
		stripeSubscriptionId: { type: String },
		subscriptionStatus: { type: String },
		currentPeriodStart: { type: Date },
		currentPeriodEnd: { type: Date },
		cancelAt: { type: Date },
		// Emails sent this month of the paid period (lib/usage-period.js): every kind counts. welcomePausedAt: when the
		// month's first welcome email was skipped for want of emails left, which told the owner; a new month clears it.
		usage: {
			emailsSent: { type: Number, default: 0 },
			periodStart: { type: Date },
			periodEnd: { type: Date },
			anchor: { type: Date },
			paidThrough: { type: Date },
			welcomePausedAt: { type: Date },
		},
		// "paused" is a blocked account (lib/account-blocks.js): it sends nothing, welcome and confirmation emails
		// included, and refuses every change but stopping things, until an admin unblocks it. pauseReason is what its
		// owner sees.
		status: { type: String, enum: ACCOUNT_STATUSES, default: "active" },
		pausedAt: { type: Date },
		pauseReason: { type: String, trim: true },
		// admin: by hand. rates: the 7-day check (lib/account-health.js). campaign: a send's own rates. slice: a first
		// send's slice (lib/first-send.js). trap: a bounce from a spam trap. ses, postshiba, groundmail: the provider stopped the
		// account's tenant. gmail: Gmail's spam rate in Google Postmaster Tools (lib/postmaster.js).
		pausedBy: { type: String, enum: BLOCK_SOURCES },
		// The last time an admin unblocked it: Gmail's data on the days up to then doesn't block it again.
		unblockedAt: { type: Date },
		// The account's SES tenant and configuration set, created when its plan starts (lib/email-provider/ses.js).
		ses: {
			tenantName: { type: String },
			tenantArn: { type: String },
			configurationSet: { type: String },
			provisionedAt: { type: Date },
			// Last status SES reported through EventBridge: ENABLED, DISABLED or REINSTATED.
			tenantStatus: { type: String },
			tenantStatusAt: { type: Date },
			lastFinding: { type: String },
		},
		// The account's PostShiba tenant (slug mc-<accountId>) and SMTP credentials, created when its plan starts
		// (lib/email-provider/postshiba.js).
		postshiba: {
			tenantId: { type: String },
			tenantSlug: { type: String },
			// active, suspended (with the account's pause) or operator_hold (PostShiba's abuse team paused it).
			tenantStatus: { type: String },
			tenantStatusAt: { type: Date },
			provisionedAt: { type: Date },
			// Campaigns go out over HTTP inject with this login. PostShiba shows the password once; it's stored
			// AES-256-GCM encrypted (lib/credentials.js) and only read where a send needs it.
			bulkCredential: {
				credentialId: { type: String },
				username: { type: String },
				password: { type: String, select: false },
				clusterId: { type: String },
			},
			// POST /sends needs a live credential for the tenant on the transactional cluster, not its password.
			transactionalCredential: {
				credentialId: { type: String },
				clusterId: { type: String },
			},
		},
		// The account's Groundmail tenant (external id mc-<accountId>), created when its plan starts
		// (lib/email-provider/groundmail.js). None while the Groundmail account has no tenants: it sends as that account.
		groundmail: {
			tenantId: { type: String },
			externalId: { type: String },
			// active, paused (with the account's block) or held (Groundmail paused it).
			tenantStatus: { type: String },
			tenantStatusAt: { type: Date },
			provisionedAt: { type: Date },
		},
		// The last account-level check on recent sends.
		health: {
			checkedAt: { type: Date },
			sent: { type: Number },
			delivered: { type: Number },
			bounceRate: { type: Number },
			complaintRate: { type: Number },
		},
		// What the account answered at /welcome (lib/onboarding.js): listSize picks the plan the paywall shows first.
		// checklistDismissedAt and checklistFinishedAt are from before each newsletter had its own get-started panel
		// (lib/get-started.js): nothing sets them now, and the panel stays hidden for the newsletters the account had then.
		onboarding: {
			listSize: { type: String, trim: true },
			listSource: { type: String, trim: true },
			completedAt: { type: Date },
			checklistDismissedAt: { type: Date },
			checklistFinishedAt: { type: Date },
		},
		// The changelog entries, by id, its owner closed the dashboard's what's new card on: MailCheap Cloud's WhatsNew
		// site extension (components/SiteExtensions.jsx) only lists the others.
		changelog: {
			seen: { type: [String], default: undefined },
		},
		// The timezone its newsletters' summary emails go out in (lib/summary.js), saved from its owner's browser by the
		// dashboard. How often each one comes is the newsletter's (notifications.summary).
		summary: {
			timeZone: { type: String },
		},
		// The fields its contacts can hold besides a first name and tags, shared by its newsletters (lib/contact-fields.js).
		// Each contact keeps its values under fields.<key>; deleting a field here leaves them on the contacts.
		contactFields: {
			type: [
				{
					_id: false,
					key: { type: String, required: true },
					label: { type: String, required: true, trim: true },
					type: { type: String, enum: FIELD_TYPE_IDS, required: true },
					createdAt: { type: Date },
				},
			],
			default: undefined,
		},
		// Set by an admin; they replace the plan's numbers.
		limitOverrides: {
			emailsPerMonth: { type: Number, min: 0 },
			subscribers: { type: Number, min: 0 },
		},
		// A free plan an admin gave from /admin (lib/billing.js grantFreePlan): the plan's limits without Stripe, from
		// grantedAt until `until`, or with no end. Ending it sets `until`. by: the admin's email.
		comp: {
			plan: { type: String, enum: PLAN_IDS },
			grantedAt: { type: Date },
			until: { type: Date },
			by: { type: String, trim: true },
		},
		// The owner deleted the account (lib/account-deletion.js): it stopped at once, and its data goes for good at
		// purgeAt unless they sign in and restore it before. Once the purge has started, it can't be restored.
		deletion: {
			requestedAt: { type: Date },
			purgeAt: { type: Date },
			purgeStartedAt: { type: Date },
		},
	},
	{ timestamps: true }
);

accountSchema.index(
	{ stripeCustomerId: 1 },
	{ unique: true, partialFilterExpression: { stripeCustomerId: { $type: "string" } } }
);
accountSchema.index({ stripeSubscriptionId: 1 }, { partialFilterExpression: { stripeSubscriptionId: { $type: "string" } } });
accountSchema.index({ createdAt: -1 });
accountSchema.index({ "ses.tenantName": 1 }, { unique: true, partialFilterExpression: { "ses.tenantName": { $type: "string" } } });
accountSchema.index({ "postshiba.tenantSlug": 1 }, { unique: true, partialFilterExpression: { "postshiba.tenantSlug": { $type: "string" } } });

export default mongoose.models.Account || mongoose.model("Account", accountSchema);
