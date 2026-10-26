# Step 7: UI Components and Campaign Editor

This guide details the React and Tailwind CSS v4 components required to compose and preview SMS campaigns within MailCheap's existing dashboard aesthetics.

---

## 1. Design System & UX Standards

In accordance with MailCheap's design philosophy:
- **Clean and Minimalist**: Monochrome palette with crisp borders, matching light and dark themes.
- **Sentence Case**: Buttons and headings use sentence case ("Send SMS", "Message preview").
- **Zero Emojis**: Statuses use badges (`BadgeStatus`), notices, and Lucide icons.
- **Component File Naming**: PascalCase starting with component kind (`EditorSms.jsx`, `SmartphonePreview.jsx`).

---

## 2. Channel Selector in `FormCampaign.jsx`

At the top of the campaign editor's Write step, a tab switch lets authors select between Email and SMS:

```jsx
// components/FormCampaign.jsx snippet
<div className="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit">
	<button
		type="button"
		onClick={() => setChannel("email")}
		className={cn(
			"px-3 py-1 text-sm font-medium rounded-md transition-colors",
			channel === "email" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
		)}
	>
		Email
	</button>
	<button
		type="button"
		onClick={() => setChannel("sms")}
		className={cn(
			"px-3 py-1 text-sm font-medium rounded-md transition-colors",
			channel === "sms" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
		)}
	>
		SMS
	</button>
</div>
```

---

## 3. SMS Composer (`components/EditorSms.jsx`)

The SMS editor provides live segment accounting, character limits, and tag insertions:

```jsx
// components/EditorSms.jsx
"use client";

import { useMemo } from "react";
import { CircleAlert, Link2, User } from "lucide-react";
import { analyzeSmsContent } from "@/lib/sms-utils";
import { Button } from "@/components/ui/button";

export default function EditorSms({ value = "", onChange, onInsertLink }) {
	const stats = useMemo(() => analyzeSmsContent(value), [value]);

	function insertTag(tag) {
		onChange(`${value} ${tag} `.trimStart());
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between border-b pb-2">
				<div className="flex items-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => insertTag("{{first_name}}")}
						className="gap-1.5 text-xs"
					>
						<User className="w-3.5 h-3.5" />
						First name
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={onInsertLink}
						className="gap-1.5 text-xs"
					>
						<Link2 className="w-3.5 h-3.5" />
						Short link
					</Button>
				</div>

				<div className="text-xs text-muted-foreground font-mono">
					{stats.length} chars · {stats.segments} segment{stats.segments > 1 ? "s" : ""} ({stats.encoding})
				</div>
			</div>

			<textarea
				rows={6}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder="Write your text message here... Include 'Reply STOP to opt out'."
				className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-sans"
			/>

			{stats.isUcs2 && (
				<div className="flex items-center gap-2 p-2.5 text-xs rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
					<CircleAlert className="w-4 h-4 shrink-0" />
					<span>
						Non-GSM characters detected: message encoded in UCS-2 (limited to 70 characters per segment instead of 160).
					</span>
				</div>
			)}
		</div>
	);
}
```

---

## 4. Mobile Phone Mockup (`components/SmartphonePreview.jsx`)

A visual smartphone simulator provides immediate feedback on text wrapping and link rendering:

```jsx
// components/SmartphonePreview.jsx
"use client";

export default function SmartphonePreview({ message = "", senderName = "MailCheap" }) {
	const renderedMessage = message.replace(/\{\{\s*first_name\s*\}\}/gi, "Alex");

	return (
		<div className="w-[280px] mx-auto border-4 border-foreground/10 rounded-[36px] p-3 bg-background shadow-xl">
			{/* Top speaker notch */}
			<div className="w-20 h-3 bg-muted rounded-full mx-auto mb-4" />

			{/* Conversation header */}
			<div className="text-center border-b pb-2 mb-4">
				<div className="w-8 h-8 rounded-full bg-muted text-muted-foreground text-xs flex items-center justify-center font-medium mx-auto mb-1">
					{senderName.slice(0, 2).toUpperCase()}
				</div>
				<p className="text-xs font-medium text-foreground">{senderName}</p>
				<p className="text-[10px] text-muted-foreground">Text message</p>
			</div>

			{/* Message bubble */}
			<div className="min-h-[220px] flex flex-col justify-end">
				{renderedMessage ? (
					<div className="bg-primary text-primary-foreground text-xs rounded-2xl rounded-br-sm px-3.5 py-2 max-w-[85%] ml-auto whitespace-pre-wrap break-words leading-relaxed shadow-sm">
						{renderedMessage}
					</div>
				) : (
					<div className="text-center text-xs text-muted-foreground italic">
						Start typing to preview the message...
					</div>
				)}
				<p className="text-[10px] text-muted-foreground text-right mt-1 pr-1">Now</p>
			</div>

			{/* Home bottom indicator */}
			<div className="w-24 h-1 bg-muted-foreground/30 rounded-full mx-auto mt-6" />
		</div>
	);
}
```
