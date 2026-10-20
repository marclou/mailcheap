import { escapeHtml } from "./render-email.js";

// {{first_name}} prints the reader's first name, {{first_name|there}} prints "there" for a reader without one. It works
// in the subject, the preview text and the content of issues, welcome, confirmation and last-chance emails, filled in
// per recipient as the email goes out (lib/sending-rules.js). Anywhere public, like the archive, it prints the fallback.
export const MERGE_TAG_PATTERN = /\{\{\s*first_name\s*(?:\|([^{}]{0,100}?))?\s*\}\}/gi;
export const DEFAULT_FALLBACK = "there";
// Who the dashboard's previews and test emails greet when the test address isn't a contact with a name.
export const SAMPLE_FIRST_NAME = "Jane";

export function firstNameTag(fallback = DEFAULT_FALLBACK) {
	return fallback ? `{{first_name|${fallback}}}` : "{{first_name}}";
}

export function hasMergeTags(value) {
	return new RegExp(MERGE_TAG_PATTERN.source, "i").test(String(value ?? ""));
}

const ANY_TAG_PATTERN = /\{\{[^{}]{0,200}\}\}/g;
const WHOLE_TAG_PATTERN = new RegExp(`^${MERGE_TAG_PATTERN.source}$`, "i");

// {{...}} that isn't {{first_name}}: another platform's tag, a typo, or a tag split by formatting. It would go out as
// written, so the review step points it out.
export function findBrokenMergeTags(...values) {
	const broken = new Set();
	for (const value of values) {
		for (const [token] of String(value ?? "").matchAll(ANY_TAG_PATTERN)) {
			if (!WHOLE_TAG_PATTERN.test(token)) broken.add(token);
		}
	}
	return [...broken];
}

// isHtml: the value is HTML, where the name is escaped and the fallback is already written as HTML.
export function fillMergeTags(value, { firstName = "", isHtml = false } = {}) {
	const text = String(value ?? "");
	if (!text.includes("{{")) return text;
	const name = String(firstName ?? "").trim();
	return text.replace(MERGE_TAG_PATTERN, (_, fallback = "") => {
		if (!name) return fallback.trim();
		return isHtml ? escapeHtml(name) : name;
	});
}

// What a reader without a first name sees: the archive, its share images and anything else public.
export function withMergeFallbacks(value, { isHtml = false } = {}) {
	return fillMergeTags(value, { isHtml });
}

// The dashboard's previews: what a reader called Jane sees.
export function fillSampleName(value, { isHtml = false } = {}) {
	return fillMergeTags(value, { firstName: SAMPLE_FIRST_NAME, isHtml });
}

// A subject is a header: whatever the name holds, it stays on one line.
export function fillSubject(subject, firstName) {
	return fillMergeTags(subject, { firstName })
		.replace(/[\r\n]+/g, " ")
		.trim();
}
