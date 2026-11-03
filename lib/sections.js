import { cleanRichHtml, decodeEntities, hasSectionRules, readHtmlBlocks, resolveSectionElements } from "./clean-html.js";
import { cleanTag } from "./contact-fields.js";
import { isObjectIdString } from "./validation.js";

// A section shows part of an issue to some of its readers, or only in its emails or only on the website. The editor and
// the API keep it in the issue's HTML as <section data-section="" data-show="tag:vip" data-where="email">…</section>:
// data-show names the readers who see it and data-hide those who don't, by tag (percent-encoded, as in a link) or by
// segment ID, and without either everyone does; data-where is email or web, both without it. Who sees it only counts in
// emails: the website doesn't know who's reading. Whatever reads an issue resolves its sections here first, and one
// whose rules can't be read shows to nobody, like any the cleaners find left (lib/clean-html.js).

export const SECTION_PLACES = ["both", "email", "web"];
export const MAX_SECTIONS = 20;
export const MAX_SECTION_GROUPS = 10;
export const SECTION_PLACE_LABELS = { both: "Email and web", email: "Email only", web: "Web only" };
export const SECTION_UNREADABLE = "A section's readers can't be read: pick who sees it";
export const SECTION_SEGMENT_DELETED = "A section's segment was deleted: pick who sees it";

const ATTRIBUTE_PATTERN = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const GROUP_PATTERN = /^(tag|segment):(.+)$/i;
// A section's own attributes, which only rich HTML reads: Markdown and designed emails would show its content to all.
// Each try stops at the next "<", so a long run of "<section" is read once.
export const SECTION_ATTRIBUTE_PATTERN = /<section\b[^<>]*\bdata-(?:section|show|hide|where)\b/i;

function readAttributes(attributes) {
	const values = {};
	for (const [, name, double, single, bare] of String(attributes ?? "").matchAll(ATTRIBUTE_PATTERN)) {
		const key = name.toLowerCase();
		if (!Object.hasOwn(values, key)) values[key] = decodeEntities(double ?? single ?? bare ?? "");
	}
	return values;
}

// "tag:vip" or "segment:<id>", as a group: { kind, value }, or null when it names nothing a section can show to.
export function readSectionGroup(value) {
	const match = GROUP_PATTERN.exec(String(value ?? "").trim());
	if (!match) return null;
	const kind = match[1].toLowerCase();
	if (kind === "segment") return isObjectIdString(match[2]) ? { kind, value: match[2].toLowerCase() } : null;
	let text = match[2];
	try {
		text = decodeURIComponent(text);
	} catch {
		return null;
	}
	const tag = cleanTag(text);
	return tag ? { kind, value: tag } : null;
}

export function formatSectionGroup({ kind, value }) {
	return `${kind}:${kind === "tag" ? encodeURIComponent(value) : value}`;
}

// A section's rules from its attributes' values: { group, isExcept, place }, group null for everyone, or null when they
// can't be read, like a section naming who sees it and who doesn't at once.
export function readSectionRule({ show = null, hide = null, where = null } = {}) {
	if (show !== null && hide !== null) return null;
	const named = show ?? hide;
	const group = named === null ? null : readSectionGroup(named);
	if (named !== null && !group) return null;
	const place = where === null ? "both" : String(where).trim().toLowerCase();
	if (!SECTION_PLACES.includes(place)) return null;
	return { group, isExcept: hide !== null, place };
}

function readTagRule(attributes) {
	const values = readAttributes(attributes);
	return readSectionRule({ show: values["data-show"] ?? null, hide: values["data-hide"] ?? null, where: values["data-where"] ?? null });
}

// The attributes a section's rules are written with, as the editor and the API keep them.
export function writeSectionRule({ group = null, isExcept = false, place = "both" } = {}) {
	return {
		...(group && { [isExcept ? "data-hide" : "data-show"]: formatSectionGroup(group) }),
		...(place !== "both" && { "data-where": place }),
	};
}

// Each section of the HTML, nested ones included, in order: its rules, or null for one that can't be read.
export function listSections(html) {
	const rules = [];
	resolveSectionElements(html, (attributes) => {
		rules.push(readTagRule(attributes));
		return true;
	});
	return rules;
}

// A section inside another, which the editor can't hold: opening the issue there would move it out.
export function hasNestedSections(html) {
	let isNested = false;
	resolveSectionElements(html, (_attributes, depth) => {
		isNested ||= depth > 0;
		return true;
	});
	return isNested;
}

// The tags and segments the issue's sections name, each once.
export function listSectionGroups(html) {
	const groups = new Map();
	for (const rule of listSections(html)) {
		if (rule?.group) groups.set(formatSectionGroup(rule.group), rule.group);
	}
	return [...groups.values()];
}

export function listSectionSegmentIds(html) {
	return listSectionGroups(html)
		.filter(({ kind }) => kind === "segment")
		.map(({ value }) => value);
}

export function hasSections(html) {
	return /<section[\s/>]/i.test(String(html ?? ""));
}

// A section's rules in an HTML block's HTML, which no reader's email or page resolves: the block goes (lib/clean-html.js).
// Its blocks are read as an email reads them, every section in.
export function hasSectionsInBlocks(html) {
	return /data-html-block/i.test(String(html ?? "")) && readHtmlBlocks(cleanRichHtml(withAllSections(html))).some(hasSectionRules);
}

// Whether a reader of the email sees a section. reader: { tags, segments }, segments the issue's live segments by ID,
// true for those the reader is in. A segment it doesn't know, deleted or another newsletter's, shows to nobody, even
// as everyone except its readers.
export function isShownTo(rule, reader) {
	if (!rule || rule.place === "web") return false;
	if (!rule.group) return true;
	let isIn;
	if (rule.group.kind === "tag") isIn = (reader?.tags ?? []).includes(rule.group.value);
	else if (reader?.segments && Object.hasOwn(reader.segments, rule.group.value)) isIn = Boolean(reader.segments[rule.group.value]);
	else return false;
	return rule.isExcept ? !isIn : isIn;
}

// One reader's email.
export function forReader(html, reader) {
	return resolveSectionElements(html, (attributes) => isShownTo(readTagRule(attributes), reader));
}

// A reader for isShownTo, from a contact's tags and the issue's live segments: members, each segment's ID to the IDs of
// the contacts in it, as lib/segment-queries.js finds them.
export function toSectionReader(contact, members = new Map()) {
	const id = String(contact?._id ?? "");
	return { tags: contact?.tags ?? [], segments: Object.fromEntries([...members].map(([segmentId, ids]) => [segmentId, ids.has(id)])) };
}

// Who a test email is for: every section an email could have, so they can all be checked in an inbox.
export const EVERY_READER = Object.freeze({ isEvery: true });

// An email's sections: a reader's, every one for EVERY_READER, and without a reader only those for everyone.
export function forEmail(html, reader) {
	if (reader === EVERY_READER) return withEmailSections(html);
	return reader ? forReader(html, reader) : resolveSectionElements(html, (attributes) => {
		const rule = readTagRule(attributes);
		return Boolean(rule) && rule.place !== "web" && !rule.group;
	});
}

// The website, its share image and thumbnail: the sections set to show there, to every visitor.
export function forWeb(html) {
	return resolveSectionElements(html, (attributes) => {
		const rule = readTagRule(attributes);
		return Boolean(rule) && rule.place !== "email";
	});
}

// The email with every section a reader could get: what a test email shows and the size check measures.
export function withEmailSections(html) {
	return resolveSectionElements(html, (attributes) => {
		const rule = readTagRule(attributes);
		return Boolean(rule) && rule.place !== "web";
	});
}

// Every section, those that can't be read too: what the review step and the content check read.
export function withAllSections(html) {
	return resolveSectionElements(html, () => true);
}

// What a section's rules say, for people: "Only readers tagged vip", "Everyone except readers in Engaged". segments:
// the newsletter's live segments, { id, name }, for their names; one it doesn't have reads as deleted.
export function describeSectionReaders(rule, segments = []) {
	if (!rule) return "Readers it can't name";
	if (!rule.group) return "Everyone";
	const group = describeGroup(rule.group, segments);
	return rule.isExcept ? `Everyone except ${group}` : `Only ${group}`;
}

// A tag's or a segment's readers, for people: "Readers tagged “vip”", "Readers in “Engaged”". The quotes tell the tag or
// the segment's name from the words around it.
export function describeSectionGroup(group, segments = []) {
	const text = describeGroup(group, segments);
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function describeGroup({ kind, value }, segments) {
	if (kind === "tag") return `readers tagged “${value}”`;
	const segment = segments.find(({ id }) => String(id) === value);
	return segment ? `readers in “${segment.name}”` : "readers in a deleted segment";
}

// What holds the issue's send, or null: a section whose rules can't be read, or naming a segment the newsletter doesn't
// have. segmentIds: its live segments.
export function findSectionProblem(html, segmentIds = []) {
	const live = new Set(segmentIds.map(String));
	for (const rule of listSections(html)) {
		if (!rule) return SECTION_UNREADABLE;
		if (rule.group?.kind === "segment" && !live.has(rule.group.value)) return SECTION_SEGMENT_DELETED;
	}
	return null;
}
