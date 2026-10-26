# Step 2: Database Models and Schema Enhancements

This document outlines the modifications made to MailCheap's Mongoose data models in `models/` to support phone numbers, SMS opt-ins, suppression lists, and multi-channel campaigns while preserving multi-tenant isolation via `scoped()`.

---

## 1. Contact Schema (`models/Contact.js`)

In MailCheap, subscribers belong to a `Newsletter`. An email address remains the primary anchor of an audience member, while a phone number is an optional channel attribute.

### Schema Additions

```javascript
// models/Contact.js

export const SMS_STATUSES = ["none", "active", "unsubscribed", "bounced"];

// Inside contactSchema definition:
{
	// Existing fields: newsletterId, email, status, firstName, tags, fields...

	// International E.164 phone number, e.g. "+33612345678"
	phone: { type: String, trim: true, index: true },

	// Two-letter ISO country code derived from the phone prefix (e.g. "FR", "US")
	phoneCountry: { type: String, trim: true },

	// Channel status independent from the email subscription status
	smsStatus: {
		type: String,
		enum: SMS_STATUSES,
		default: "none",
		index: true,
	},

	// Timestamp and provenance of the phone opt-in
	smsConsent: {
		userId: { type: mongoose.Schema.Types.ObjectId },
		source: { type: String, trim: true },
		at: { type: Date },
	},

	smsSubscribedAt: { type: Date },
	smsUnsubscribedAt: { type: Date },
	lastSmsSentAt: { type: Date },
	lastSmsClickAt: { type: Date },
}
```

### Composite Indexes
Add an index to accelerate audience count queries for SMS broadcasts:

```javascript
contactSchema.index({ newsletterId: 1, smsStatus: 1, phone: 1 });
```

---

## 2. Campaign Schema (`models/Campaign.js`)

Campaigns in MailCheap currently handle rich HTML and Markdown emails. Introducing a `channel` discriminator allows a unified campaign lifecycle (`draft` -> `scheduled` -> `sending` -> `sent`) while tailoring the content payload.

### Schema Additions

```javascript
// models/Campaign.js

export const CAMPAIGN_CHANNELS = ["email", "sms"];

// Inside campaignSchema definition:
{
	// Existing fields: newsletterId, subject, previewText, format, html, markdown, status...

	// Communication channel
	channel: {
		type: String,
		enum: CAMPAIGN_CHANNELS,
		default: "email",
		index: true,
	},

	// Raw SMS message text
	smsText: {
		type: String,
		default: "",
		trim: true,
	},

	// Calculated billing segments (1 for <=160 GSM-7 chars, etc.)
	smsSegments: {
		type: Number,
		default: 1,
		min: 1,
	},

	// Detected character encoding (GSM-7 or UCS-2)
	smsEncoding: {
		type: String,
		enum: ["GSM-7", "UCS-2"],
		default: "GSM-7",
	},
}
```

---

## 3. Suppression Schema (`models/Suppression.js`)

MailCheap enforces a suppression list to guarantee that unsubscribed or complaining contacts never receive further messages. This suppression table must now accommodate phone numbers.

### Schema Additions

```javascript
// models/Suppression.js

// Inside suppressionSchema definition:
{
	newsletterId: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true },

	// Distinguishes email suppressions from phone suppressions
	targetType: {
		type: String,
		enum: ["email", "phone"],
		default: "email",
		index: true,
	},

	// Stored email address (lowercase, trimmed)
	email: { type: String, lowercase: true, trim: true },

	// Stored E.164 phone number
	phone: { type: String, trim: true, index: true },

	reason: {
		type: String,
		enum: ["unsubscribe", "stop", "bounce", "complaint", "admin"],
		required: true,
	},

	at: { type: Date, default: Date.now },
}
```

---

## 4. Multi-Tenant Scoping Rule (`lib/account-scope.js`)

Every database operation executed on behalf of a tenant or customer must pass through `scoped(account, filter)`. Mongoose plugins in MailCheap reject customer queries lacking an account scope.

### Safe Query Example

```javascript
import { scoped } from "@/lib/account-scope";
import Contact from "@/models/Contact";

// Retrieve active SMS recipients for a campaign
export async function getActiveSmsRecipients(account, newsletterId) {
	return Contact.find(
		scoped(account, {
			newsletterId,
			smsStatus: "active",
			phone: { $exists: true, $ne: null },
		})
	).select({ phone: 1, firstName: 1, phoneCountry: 1 });
}
```

---

## 5. Backward Compatibility & Data Migrations

No database migration script is strictly required. Existing documents without the new fields will naturally evaluate to:
- `contact.phone === undefined`
- `contact.smsStatus === "none"`
- `campaign.channel === "email"`

This ensures that existing email newsletters, campaigns, and subscriber queries continue to function without data disruption.
