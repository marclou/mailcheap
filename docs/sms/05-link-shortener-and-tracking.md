# Step 5: URL Shortener and Click Tracking

This document explains the implementation of the lightweight URL shortener route (`/s/[id]`) designed to preserve character limits in SMS messages while providing click tracking.

---

## 1. The Character Budget Problem

In standard SMS (GSM-7), a single message segment is limited to **160 characters**. Typical web URLs, especially those with UTM parameters or subdomains, frequently span 60 to 90 characters:

```
https://my-brand.mailcheap.ai/archive/special-edition-announcement?utm_source=sms
(81 characters -> leaves only 79 characters for message content!)
```

A built-in shortener reduces URLs to approximately 24-28 characters (e.g., `https://mailcheap.ai/s/k8P2wX`), leaving ample room for copy and compliance notices.

---

## 2. CampaignLink Extension (`models/CampaignLink.js`)

The existing `CampaignLink` model in MailCheap records link URLs found in newsletter issues. We augment it with a unique short code:

```javascript
// models/CampaignLink.js addition

// Inside campaignLinkSchema:
{
	// Existing fields: campaignId, newsletterId, url, clicks...

	shortCode: {
		type: String,
		index: true,
		unique: true,
		sparse: true,
	},
}
```

---

## 3. Short Link Generation (`lib/sms-links.js`)

A random 6-character alphanumeric string (base62) yields over 56 billion unique identifiers:

```javascript
// lib/sms-links.js
import "server-only";
import crypto from "node:crypto";
import { getAppUrl } from "@/lib/config";
import CampaignLink from "@/models/CampaignLink";

const CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function generateCode(length = 6) {
	const bytes = crypto.randomBytes(length);
	let code = "";
	for (let i = 0; i < length; i++) {
		code += CHARS[bytes[i] % CHARS.length];
	}
	return code;
}

export async function createShortLink({ campaignId, newsletterId, targetUrl }) {
	const existing = await CampaignLink.findOne({ campaignId, url: targetUrl });
	if (existing?.shortCode) {
		return `${getAppUrl()}/s/${existing.shortCode}`;
	}

	const code = generateCode(6);
	await CampaignLink.create({
		campaignId,
		newsletterId,
		url: targetUrl,
		shortCode: code,
		clicks: 0,
	});

	return `${getAppUrl()}/s/${code}`;
}
```

---

## 4. Redirection Route Handler (`app/s/[id]/route.js`)

The redirection route must remain minimal, responding with an HTTP 302 redirect without blocking on database writes:

```javascript
// app/s/[id]/route.js
import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import CampaignLink from "@/models/CampaignLink";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
	const { id: code } = await params;
	if (!code || code.length > 12) {
		return new Response("Invalid link", { status: 404 });
	}

	await connectDb();
	const link = await CampaignLink.findOne({ shortCode: code }).select({ url: 1, _id: 1 }).lean();
	if (!link?.url) {
		return new Response("Link not found", { status: 404 });
	}

	// Increment clicks asynchronously without delaying the HTTP response
	CampaignLink.updateOne({ _id: link._id }, { $inc: { clicks: 1 } }).catch((err) =>
		console.error("Failed to increment SMS link clicks:", err.message)
	);

	return NextResponse.redirect(link.url, { status: 302 });
}
```

---

## 5. Security & Redirect Protections

In accordance with MailCheap's security guidelines (`AGENTS.md`):
- **Protocol verification**: Links redirect only to `http://` or `https://` schemes, preventing `javascript:` or `data:` URL injections.
- **Bot filtering**: Automated carrier link previewers or SMS antivirus scanners are filtered using user-agent heuristics to prevent inflated click counters.
