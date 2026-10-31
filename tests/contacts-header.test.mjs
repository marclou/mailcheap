import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FORM_SECTION, getSectionPath } from "../lib/newsletter-sections.js";
import { as, catchRedirect, form, signIn, startTestApp } from "./helpers/app.mjs";

// The actions at the top of the Contacts page are the same whatever the list holds (components/ButtonsContacts.jsx):
// Segments and Fields, to show what a list can do before it has anyone, Add contacts, with every way to add them
// (components/DialogAddContacts.jsx), and a ⋯ menu with the export and the help article. The menu and the window only
// render once opened, so their source says what they have.
const HEADER = ["Segments", "Fields", "Add contacts", "More"];

function readSource(path) {
	return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

// Each JSX element's attributes and what it wraps, with the text left once tags are taken out.
function readElements(source, name) {
	return [...source.matchAll(new RegExp(`<${name}\\b((?:[^>{}]|\\{[^{}]*\\})*)>([\\s\\S]*?)</${name}>`, "g"))].map(([, attributes, inner]) => ({
		attributes,
		label: inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
	}));
}

test("Add contacts has every way, in order: an import, the API, the form for the owner's site, then by hand", async () => {
	const source = await readSource("components/DialogAddContacts.jsx");
	const ways = readElements(source, "TileWay").map(({ attributes }) => ({
		title: attributes.match(/title=(?:"([^"]+)"|\{([^{}]+)\})/).slice(1).find(Boolean),
		description: attributes.match(/description="([^"]+)"/)?.[1],
		action: attributes.match(/(?:onPick=\{\(\) => pick\("(\w+)"\)\}|href=\{([^{}]+)\})/).slice(1).find(Boolean),
	}));
	assert.deepEqual(
		ways.map(({ title, action }) => [title, action]),
		[
			["Import a CSV", "import"],
			["With the API", "api"],
			["FORM_SECTION.label", "getSectionPath(FORM_SECTION.id)"],
			["By hand", "add"],
		]
	);
	for (const { title, description } of ways) assert.ok(description, `${title} says what it's for`);
	assert.equal(FORM_SECTION.label, "Form for your site");
	assert.equal(getSectionPath(FORM_SECTION.id), "/newsletters/form", "the form opens its settings");
	assert.match(source, /function pick\(name\) \{[^}]*if \(name === "import" && paywall && !paywall\.hasPlan\) paywall\.open\("import"\);\s*else setWay\(name\);/);

	// Each way opens its own window, which gives the focus back to Add contacts.
	const windows = { DialogImportContacts: "import", DialogContactsApi: "api", DialogAddContact: "add" };
	for (const [name, way] of Object.entries(windows)) {
		const [, attributes] = source.match(new RegExp(`<${name}\\b((?:[^>{}]|\\{[^{}]*\\})*)/>`)) ?? [];
		assert.ok(attributes, name);
		assert.match(attributes, new RegExp(`isOpen=\\{way === "${way}"\\}`), name);
		assert.match(attributes, /onCloseAutoFocus=\{returnFocus\}/, name);
	}
	assert.match(source, /<DialogTrigger ref=\{triggerRef\} asChild>/);
	assert.match(source, /function returnFocus\(event\) \{\s*event\.preventDefault\(\);\s*triggerRef\.current\?\.focus\(\);/);
});

test("the ⋯ menu holds the export, Delete once filters narrow the list, and the help article, plus Segments and Fields on phones", async () => {
	const source = await readSource("components/ButtonsContacts.jsx");
	const menu = source.match(/<DropdownMenuContent\b[\s\S]*?<\/DropdownMenuContent>/)?.[0] ?? "";
	const items = readElements(menu, "DropdownMenuItem");
	assert.deepEqual(
		items.map(({ label }) => label),
		["Segments", "Contact fields", 'Export {formatCount(count, "contact")}', 'Delete {formatCount(count, "contact")}', "How contacts work"]
	);
	for (const item of items.slice(0, 2)) assert.match(item.attributes, /className="sm:hidden"/, `${item.label}: a button on wider screens`);
	assert.match(menu, /\{hasContacts && \(\s*<DropdownMenuItem onSelect=\{download\}/, "Export, once the list has anyone");
	assert.match(menu, /\{canDelete && \(/);
	assert.match(source, /const canDelete = hasContactFilters\(filters\) && count > 0;/);
	assert.match(menu, /<DropdownMenuSeparator className=\{cn\(!hasContacts && "sm:hidden"\)\} \/>/, "no line on top of the help article alone");
	assert.doesNotMatch(menu, /Add contacts|Import|With the API|By hand|FORM_SECTION/, "adding contacts is Add contacts' own");
});

describe("the Contacts page", () => {
	let app;
	let m;
	let user;
	let newsletterId;

	before(async () => {
		app = await startTestApp();
		m = {
			newsletters: await import("../app/(app)/newsletters/actions.js"),
			contactsPage: await import("../app/(app)/contacts/page.js"),
			helpPage: await import("../app/(site)/help/contacts/page.js"),
			importingPage: await import("../app/(site)/help/importing-contacts/page.js"),
			websitePage: await import("../app/(site)/help/website/page.js"),
			Contact: (await import("../models/Contact.js")).default,
			TooltipProvider: (await import("../components/ui/tooltip.jsx")).TooltipProvider,
		};
		user = await signIn("contacts-header@example.com");
		const url = await as(user, () =>
			catchRedirect(m.newsletters.saveNewsletter(null, form({ name: "Header news", slug: "header-news", postalAddress: "1 Main St, Paris" })))
		);
		newsletterId = url.split("/").at(-1);
	});

	after(() => app?.stop());

	async function render(searchParams = {}) {
		const page = await as(user, () => m.contactsPage.default({ searchParams: Promise.resolve(searchParams) }));
		return renderToStaticMarkup(createElement(m.TooltipProvider, null, page));
	}

	function readHeaderHtml(html) {
		return html.match(/<header[^>]*>([\s\S]*?)<\/header>/)[1];
	}

	// The header's buttons and links by their text, or the ⋯ button by its label.
	function readHeader(html) {
		return [...readHeaderHtml(html).matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map(
			([, , attributes, content]) => attributes.match(/aria-label="([^"]+)"/)?.[1] ?? content.replace(/<[^>]+>/g, "").trim()
		);
	}

	function addContacts(emails, status = "active") {
		return m.Contact.insertMany(emails.map((email) => ({ accountId: user.accountId, newsletterId, email, status, source: "manual" })));
	}

	test("has the same actions at the top whatever the list holds, with Add contacts the one in black", async () => {
		const empty = await render();
		assert.deepEqual(readHeader(empty), HEADER);
		const header = readHeaderHtml(empty);
		assert.match(header.match(/<a[^>]*href="\/contacts\/segments"[^>]*>/)[0], /data-variant="outline"[^>]*max-sm:hidden|max-sm:hidden[^>]*data-variant="outline"/);
		assert.match(header.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Fields<\/button>/)[0], /data-variant="outline"[^>]*max-sm:hidden|max-sm:hidden[^>]*data-variant="outline"/);
		const add = header.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Add contacts<\/button>/)[0];
		assert.match(add, /data-variant="default"/, "the page's main action");
		assert.match(add, /aria-haspopup="dialog"/);
		assert.doesNotMatch(header, />Import</, "the import is one of Add contacts' ways");
		assert.match(empty, /Add yourself as a contact/, "the card under it has every way too");
		assert.match(empty, /Add them in one of three ways\./);
		assert.match(empty, /<a [^>]*href="\/newsletters\/form"[^>]*>(?:(?!<\/a>)[\s\S])*Set up the form<\/a>/);
		assert.match(empty, /-d &#x27;\{&quot;email&quot;:&quot;jane@example\.com&quot;,&quot;newsletter&quot;:&quot;header-news&quot;\}&#x27;/);

		await addContacts(["reader1@example.com"]);
		assert.deepEqual(readHeader(await render()), HEADER, "one contact");

		await addContacts(["reader2@example.com", "reader3@example.com"]);
		await addContacts(["reader4@example.com", "reader5@example.com"], "unsubscribed");
		for (const searchParams of [{}, { q: "reader1" }, { status: "bounced" }, { source: "nowhere" }, { signedUpBefore: "2000-01-01" }]) {
			assert.deepEqual(readHeader(await render(searchParams)), HEADER, JSON.stringify(searchParams));
		}
	});

	test("counts the whole list again when the search finds no one, to tell an empty list from a narrowed one", async () => {
		const nobody = await render({ q: "nobody" });
		assert.match(nobody, /No contacts match/);
		assert.doesNotMatch(nobody, /No contacts yet/);
	});

	test("the help center says where each action is", () => {
		const text = renderToStaticMarkup(createElement(m.helpPage.default)).replace(/<[^>]+>/g, "");
		assert.match(text, /Click Fields at the top of the Contacts page, or Contact fields in its ⋯ menu on a phone\./);
		assert.match(text, /Segments, at the top of the Contacts page, opens yours,/);
		assert.match(text, /Click Add contacts, at the top of the Contacts page, and pick how people join your list:/);
		const ways = ["Import a CSV brings in", "With the API shows", "Form for your site opens", "By hand adds one person"].map((way) => text.indexOf(way));
		assert.ok(ways.every((index, at) => index > (ways[at - 1] ?? 0)), "in Add contacts' order");
		assert.match(text, /Export, in the ⋯ menu at the top of the Contacts page, downloads the contacts that match your filters/);
		assert.match(text, /They join at once, without a confirmation email, and get your welcome email if it&#x27;s on\./);
		assert.doesNotMatch(text, /Add contact is also a button|Once your list has \d+ contacts/);

		const importing = renderToStaticMarkup(createElement(m.importingPage.default)).replace(/<[^>]+>/g, "");
		assert.match(importing, /click Add contacts, pick Import a CSV and choose the file, or drop it\s+anywhere on the page\./);
		const website = renderToStaticMarkup(createElement(m.websitePage.default)).replace(/<[^>]+>/g, "");
		assert.match(website, /By hand or from a file: Add contacts, at the top of the\s+Contacts page, lists every way to add them\./);
	});
});
