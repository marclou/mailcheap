# Step 3: Actions Architecture and Surface Parity

A central requirement in MailCheap (`AGENTS.md`) is that every customer-facing operation is registered using `defineAction` in `lib/actions/`. Customer actions must never be ad-hoc route handlers or isolated server actions.

Registering actions via `defineAction` automatically synchronizes:
1. Dashboard Server Actions (`app/(app)/*/actions.js`)
2. The Public REST API (`app/api/v1/`)
3. The AI Agent MCP Server (`/mcp` and `lib/mcp/server.js`)
4. Public OpenAPI documentation and `llms.txt`
5. Verification via `tests/parity.test.mjs`

---

## 1. Updating Campaign Actions (`lib/actions/campaigns.js`)

### Schema Updates in `create_campaign`
The `create_campaign` action schema is extended with the `channel` field:

```javascript
// lib/actions/campaigns.js

const createInput = z.object({
	newsletterId: idInput,
	channel: z.enum(["email", "sms"]).default("email"),
	subject: z.string().trim().max(200).optional(),
	smsText: z.string().trim().max(1600).optional(),
});
```

### Schema Updates in `update_campaign`
The update action accepts channel-specific content updates:

```javascript
// lib/actions/campaigns.js

const updateInput = z.object({
	id: idInput,
	subject: z.string().trim().max(200).optional(),
	previewText: z.string().trim().max(200).optional(),
	format: z.enum(FORMATS).optional(),
	html: z.string().max(MAX_BODY_BYTES).optional(),
	markdown: z.string().max(MAX_BODY_BYTES).optional(),
	// SMS fields
	channel: z.enum(["email", "sms"]).optional(),
	smsText: z.string().trim().max(1600).optional(),
	// Publishing & audience options
	publishTo: z.enum(PUBLISH_TARGETS).optional(),
	segmentId: idInput.nullable().optional(),
});
```

---

## 2. Differentiating Pre-Send Checks (`lib/presend-checks.js`)

When an author reviews an issue before sending, MailCheap runs presend checks. For email, checks inspect the subject, preview text, unsubscribe link, DKIM records, and Gmail's 100 KB clipping boundary.

For an SMS campaign, email-specific checks are replaced by telecom checks:

```javascript
// lib/presend-checks.js

export function getSmsPresendChecks({ campaign, activeSmsCount, isSmsConfigured }) {
	const checks = [];

	// 1. AWS SNS Configuration check
	if (!isSmsConfigured) {
		checks.push({
			id: "sms-provider-configured",
			passed: false,
			title: "SMS service is not configured",
			description: "Set up AWS SNS credentials in your server environment to send SMS messages.",
			level: "error",
		});
	}

	// 2. Message body check
	const text = (campaign.smsText || "").trim();
	checks.push({
		id: "sms-body-present",
		passed: text.length > 0,
		title: text.length > 0 ? "SMS message text is set" : "Message text is empty",
		description: "Enter the SMS message body before sending.",
		level: "error",
	});

	// 3. Opt-out notice check (mandatory for compliance)
	const hasOptOut = /\b(stop|arret)\b/i.test(text);
	checks.push({
		id: "sms-opt-out-included",
		passed: hasOptOut,
		title: hasOptOut ? "Opt-out instruction included" : "Missing opt-out notice",
		description: "Include 'STOP' or an unsubscribe instruction to comply with telecom regulations.",
		level: hasOptOut ? "success" : "warning",
	});

	// 4. Active audience check
	checks.push({
		id: "sms-audience-available",
		passed: activeSmsCount > 0,
		title: activeSmsCount > 0 ? `${activeSmsCount} phone subscriber${activeSmsCount > 1 ? "s" : ""}` : "No phone subscribers",
		description: activeSmsCount > 0 ? null : "There are no active subscribers with verified phone numbers in this newsletter.",
		level: activeSmsCount > 0 ? "success" : "error",
	});

	return checks;
}
```

---

## 3. Updating Contact Actions (`lib/actions/contacts.js`)

The `create_contact` and `update_contact` actions are extended to accept phone numbers and opt-in consent:

```javascript
// lib/actions/contacts.js

const contactInput = z.object({
	newsletterId: idInput,
	email: z.string().email().trim().toLowerCase(),
	firstName: z.string().trim().max(100).optional(),
	phone: z.string().trim().optional(),
	phoneConsent: z.boolean().optional(),
	tags: z.array(z.string().trim().toLowerCase()).optional(),
});
```

When a valid phone number is supplied with `phoneConsent: true`, the handler:
1. Normalizes the number to international E.164 using `formatE164()` (`lib/sms-utils.js`).
2. Extracts the ISO country code (`phoneCountry`).
3. Sets `smsStatus = "active"` and records the consent timestamp.

---

## 4. MCP Tools Integration

Because MailCheap exposes its action registry to Model Context Protocol (MCP), updating `create_campaign` and `update_campaign` automatically enables AI assistants (such as Claude Code, Cursor, ChatGPT) to:
- Draft SMS campaigns.
- Calculate segments and preview content.
- Schedule or dispatch messages with the standard human confirmation safeguard (`IRREVERSIBLE`).

---

## 5. Verification Against `tests/parity.test.mjs`

To verify that the action definitions adhere to MailCheap's parity standards, run:

```bash
node --test tests/parity.test.mjs
```

This test confirms that:
- Every action schema exposes clean documentation descriptions.
- Server actions call `runAction` exclusively.
- All actions are mirrored in the REST API and MCP tool lists.
