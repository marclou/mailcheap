import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildSearchIndex, getSections } from "../lib/search-index.js";
import { getHighlights, getSnippet, prepareIndex, search } from "../lib/search.js";

// The help center's and the docs' search: the index built from the articles' source (lib/search-index.js) and the
// matching (lib/search.js). The dialog itself: components/DialogSearch.jsx.
process.env.APP_URL = "https://mail.example.com";

const ENTRIES = [
	{ group: "help", title: "Sender addresses and domains", parent: "Your newsletter", text: "Send from the shared address, or from your own domain.", href: "/help/sender-addresses" },
	{ group: "help", title: "DMARC", parent: "Sender addresses and domains", text: "Tells inboxes what to do with emails that fail the checks.", href: "/help/sender-addresses#dmarc" },
	{ group: "help", title: "Importing contacts", parent: "Contacts", text: "Bring your list from beehiiv or Substack as a CSV file.", href: "/help/importing-contacts" },
	{ group: "api", title: "Add a contact", parent: "Contacts", text: "Signs someone up.", keywords: "POST /api/v1/contacts add_contact", href: "/docs/api#add-contact" },
	{ group: "api", title: "rate_limited", parent: "Errors", text: "Too many requests with this key.", keywords: "429 error", href: "/docs/errors#rate_limited" },
];
const index = prepareIndex(ENTRIES);

function findHrefs(query) {
	return search(index, query).flatMap(({ results }) => results.map(({ entry }) => entry.href));
}

test("a word finds entries by title first, then by their parent and text", () => {
	assert.equal(findHrefs("domain")[0], "/help/sender-addresses");
	assert.deepEqual(findHrefs("inboxes"), ["/help/sender-addresses#dmarc"]);
	assert.deepEqual(findHrefs("rate limited"), ["/docs/errors#rate_limited"]);
	assert.deepEqual(findHrefs("add_contact"), ["/docs/api#add-contact"]);
});

test("typos still find what was meant, and every word of the query has to match", () => {
	assert.ok(findHrefs("domian").includes("/help/sender-addresses"));
	assert.deepEqual(findHrefs("dmrac"), ["/help/sender-addresses#dmarc"]);
	assert.deepEqual(findHrefs("imprting"), ["/help/importing-contacts"]);
	assert.deepEqual(findHrefs("beehiiv csv"), ["/help/importing-contacts"]);
	assert.deepEqual(findHrefs("beehiiv webhook"), []);
	assert.deepEqual(findHrefs("   "), []);
});

test("results come grouped, help apart from the API, the group with the best match first", () => {
	const groups = search(index, "contacts");
	assert.deepEqual(groups.map(({ id }) => id), ["help", "api"]);
	assert.equal(groups[0].results[0].entry.href, "/help/importing-contacts");
	assert.equal(groups[1].label, "API and MCP");
	assert.deepEqual(search(index, "add contact").map(({ id }) => id), ["api"]);
});

test("matches are highlighted: the matching part of a word, or the whole word for a typo", () => {
	const title = "Sender addresses and domains";
	assert.deepEqual(getHighlights(title, "dom"), [[21, 24]]);
	assert.deepEqual(getHighlights(title, "domian"), [[21, 28]]);
	assert.deepEqual(getHighlights(title, "send addr"), [[0, 4], [7, 11]]);
	assert.deepEqual(getHighlights(title, ""), []);
});

test("a snippet shows the text around a match far into it, or the keywords when only they match", () => {
	const entry = { text: `${"Words before the match. ".repeat(8)}Turn on DMARC with p=none first, then quarantine.`, keywords: "POST /api/v1/contacts" };
	assert.match(getSnippet(entry, "quarantine"), /^….*quarantine/);
	assert.ok(getSnippet(entry, "words").startsWith("Words before"));
	assert.ok(getSnippet(entry, "words").length <= 111);
	assert.equal(getSnippet(entry, "post"), "POST /api/v1/contacts");
	assert.ok(getSnippet(entry, "").startsWith("Words before"));
});

test("an article's sections come with their ids and the words a reader sees", () => {
	const source = `<ArticleHelp slug="x">
		<h2 id="shared">The shared address</h2>
		<p>
			Each newsletter can send from <code>hello@slug.{sharedDomain}</code>, with nothing to set up.
			{isCloud() && " It's set up when your plan starts."} Your website&apos;s address follows it.
		</p>
		<h2 id="own">Your own domain</h2>
		<p>Add up to {MAX_DOMAINS} domains. <Link href={getHelpHref("deliverability")}>Bounces</Link></p>
	</ArticleHelp>`;
	assert.deepEqual(getSections(source), [
		{
			id: "shared",
			title: "The shared address",
			text: "Each newsletter can send from hello@slug.…, with nothing to set up. It's set up when your plan starts. Your website's address follows it.",
		},
		{ id: "own", title: "Your own domain", text: "Add up to … domains. Bounces" },
	]);
});

test("the index has every article's sections and the docs' endpoints; a self-hosted server leaves out cloud-only articles", async () => {
	const selfHosted = await buildSearchIndex({ env: {}, appUrl: "https://mail.example.com" });
	const cloud = await buildSearchIndex({ env: { MAILCHEAP_CLOUD: "true" }, appUrl: "https://mailcheap.ai" });
	for (const entry of cloud) {
		assert.ok(["help", "api"].includes(entry.group) && entry.title && entry.href.startsWith("/"), JSON.stringify(entry));
	}
	const hrefs = new Set(selfHosted.map(({ href }) => href));
	assert.ok(hrefs.has("/help/sender-addresses#own-domain"));
	assert.ok(hrefs.has("/docs/api#add-contact"));
	assert.ok(hrefs.has("/docs/errors#rate_limited"));
	assert.ok(hrefs.has("/docs/mcp#claude"));
	assert.ok(![...hrefs].some((href) => /^\/help\/(warm-up|plans)/.test(href)), "cloud-only articles stay out");
	assert.ok(cloud.some(({ href }) => href === "/help/warm-up#what"));

	for (const href of hrefs) {
		const [, slug, section] = href.match(/^\/help\/([^#]+)(?:#(.+))?$/) ?? [];
		if (!section) continue;
		const page = await readFile(new URL(`../app/(site)/help/${slug}/page.js`, import.meta.url), "utf8");
		assert.ok(page.includes(`id="${section}"`), `${href} is a section of its article`);
	}
});
