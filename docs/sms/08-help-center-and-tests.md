# Step 8: Help Center Article and Test Suite

This document covers updating the public Help Center to comply with `tests/help.test.mjs` and creating automated test suites to ensure zero regression.

---

## 1. Help Center Article (`app/(site)/help/sms/page.js`)

In MailCheap, every feature visible to users is documented in the help center (`app/(site)/help`). The test `tests/help.test.mjs` enforces that every article registered in `lib/help.js` possesses a corresponding page.

### Registering the Article (`lib/help.js`)

```javascript
// lib/help.js
export const HELP_ARTICLES = [
	// Existing articles: "writing", "sending", "contacts", "domains"...
	{
		slug: "sms",
		title: "Sending SMS campaigns",
		description: "How to compose text messages, manage character segments, track clicks, and maintain compliance.",
		category: "sending",
	},
];
```

### Help Center Page (`app/(site)/help/sms/page.js`)

```jsx
// app/(site)/help/sms/page.js
import ArticleHelp from "@/components/ArticleHelp";
import { getHelpPageMetadata } from "@/lib/help";

export const metadata = getHelpPageMetadata("sms");

export default function HelpSmsPage() {
	return (
		<ArticleHelp slug="sms">
			<h2>Sending text messages with MailCheap</h2>
			<p>
				MailCheap allows sending SMS campaigns alongside your regular newsletter issues.
				Like email, you only pay for what you send.
			</p>

			<h3>Segments and character limits</h3>
			<p>
				Standard text messages use the GSM-7 character set, allowing up to 160 characters in a single segment.
				Including special accents or non-standard characters triggers UCS-2 encoding, reducing segment length to 70 characters.
			</p>

			<h3>Opt-out and compliance</h3>
			<p>
				Telecom regulations require that recipients can unsubscribe at any time. Always include a notice such as
				"Reply STOP to opt out". When a subscriber replies with STOP, their phone number is automatically marked as
				unsubscribed and suppressed from future sends.
			</p>
		</ArticleHelp>
	);
}
```

---

## 2. Test Stubs for AWS SNS (`tests/stubs/sns.mjs`)

Tests must run fully offline without connecting to AWS. We create an offline stub mimicking the SNS client:

```javascript
// tests/stubs/sns.mjs
export const publishedMessages = [];

export function clearPublishedMessages() {
	publishedMessages.length = 0;
}

export class FakeSNSClient {
	async send(command) {
		publishedMessages.push(command.input);
		return {
			MessageId: `mock-msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
		};
	}
}
```

---

## 3. Unit Tests (`tests/sms-utils.test.mjs`)

```javascript
// tests/sms-utils.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeSmsContent, formatE164 } from "../lib/sms-utils.js";

test("analyzeSmsContent: accurate GSM-7 segment boundaries", () => {
	const singleSegment = "A".repeat(160);
	assert.deepEqual(analyzeSmsContent(singleSegment), {
		encoding: "GSM-7",
		length: 160,
		segments: 1,
		remainingInSegment: 0,
		isUcs2: false,
	});

	const twoSegments = "A".repeat(161);
	assert.equal(analyzeSmsContent(twoSegments).segments, 2);
	assert.equal(analyzeSmsContent(twoSegments).encoding, "GSM-7");
});

test("analyzeSmsContent: triggers UCS-2 for non-GSM characters", () => {
	const nonGsm = "Special character: \u0410"; // Cyrillic A
	const stats = analyzeSmsContent(nonGsm);
	assert.equal(stats.encoding, "UCS-2");
	assert.equal(stats.isUcs2, true);
});

test("formatE164: parses and standardizes international numbers", () => {
	assert.deepEqual(formatE164("0612345678", "FR"), {
		e164: "+33612345678",
		country: "FR",
	});

	assert.equal(formatE164("invalid-phone"), null);
});
```

---

## 4. Acceptance and PR Verification Commands

Run the full verification suite before committing:

```bash
# 1. Action and surface parity check
node --test tests/parity.test.mjs

# 2. Help center link and article integrity check
node --test tests/help.test.mjs

# 3. New SMS unit tests
node --test tests/sms-utils.test.mjs

# 4. Full integration and unit test suite
npm test

# 5. ESLint validation
npm run lint
```
