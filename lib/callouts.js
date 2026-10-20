// Boxes set a part of an issue apart, like an update or a sponsor. They are a plain gray container in
// the page's own colors.
export const CALLOUT_ATTRIBUTES = ' data-callout=""';

const CALLOUT_PATTERN = /^:::box[ \t]*\n([\s\S]*?)\n:::[ \t]*(?:\n+|$)/;
const CALLOUT_OPEN_PATTERN = /^:::box[ \t]*\n/;
const CALLOUT_START_PATTERN = /^:::box/m;
// A box with no ":::" line after it is read to the end of the document, again for each line after it.
const MAX_UNCLOSED = 10;
const CALLOUT_TAG_PATTERN = /<div\b[^>]*\bdata-callout\b[^>]*>/g;
// Email clients only apply inline styles; the bottom padding is shorter because the last paragraph
// keeps its 16px margin.
export const EMAIL_BOX_TAG = '<div style="margin:24px 0;padding:24px 24px 8px;border-radius:12px;background:#f4f4f5;">';

export function inlineCalloutStyles(html) {
	return html.replace(CALLOUT_TAG_PATTERN, EMAIL_BOX_TAG);
}

// Markdown: a box starts with a ":::box" line and ends with a ":::" line.
export function calloutExtension({ isEmail = false } = {}) {
	let progress = { unclosed: 0, read: 0, readLimit: 0 };
	return {
		hooks: {
			preprocess(markdown) {
				progress = { unclosed: 0, read: 0, readLimit: 10 * markdown.length + 10_000 };
				return markdown;
			},
		},
		extensions: [
			{
				name: "callout",
				level: "block",
				// Lets a box end the paragraph above it without a blank line. marked asks before every
				// paragraph, and reads what follows a cut again up to the next blank line, so this looks
				// that far and gives up past a few reads of the document, or once boxes stop closing.
				start(src) {
					if (progress.read > progress.readLimit || progress.unclosed >= MAX_UNCLOSED) return undefined;
					const end = src.search(/\n[ \t]*\n/);
					const paragraph = end === -1 ? src : src.slice(0, end);
					progress.read += paragraph.length;
					return CALLOUT_START_PATTERN.exec(paragraph)?.index;
				},
				tokenizer(src) {
					if (progress.unclosed >= MAX_UNCLOSED || !CALLOUT_OPEN_PATTERN.test(src)) return undefined;
					const match = CALLOUT_PATTERN.exec(src);
					if (!match) {
						progress.unclosed += 1;
						return undefined;
					}
					const token = { type: "callout", raw: match[0], tokens: [] };
					this.lexer.blockTokens(match[1], token.tokens);
					return token;
				},
				renderer(token) {
					const open = isEmail ? EMAIL_BOX_TAG : `<div${CALLOUT_ATTRIBUTES}>`;
					return `${open}${this.parser.parse(token.tokens)}</div>\n`;
				},
			},
		],
	};
}
