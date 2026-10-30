import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import NoticePace from "../components/NoticePace.jsx";
import { HELP_ARTICLES, getHelpArticles } from "../lib/help.js";
import { listAppPages } from "./helpers/app-pages.mjs";

// The help center (app/(site)/help): its articles, the dashboard's links into it and its links into the dashboard, and
// the send step's pace notice that links to it. Its pages opening without a session, in the sitemap and with their
// metadata: tests/public-site.test.mjs.
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HELP_DIR = "app/(site)/help";
// The companies that send the emails.
const PROVIDERS = /Amazon|\bAWS\b|\bSES\b|PostShiba|Resend/;

function readSource(path) {
	return readFile(join(ROOT, path), "utf8");
}

async function listSources(folder) {
	const files = await readdir(join(ROOT, folder), { recursive: true });
	return files.filter((file) => /\.jsx?$/.test(file)).map((file) => `${folder}/${file}`);
}

test("every article in lib/help.js has its page, and every page there is in the list", async () => {
	const folders = (await readdir(join(ROOT, HELP_DIR), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map(({ name }) => name);
	assert.deepEqual(folders.sort(), HELP_ARTICLES.map(({ slug }) => slug).sort());
	for (const { slug } of HELP_ARTICLES) {
		const page = await readSource(`${HELP_DIR}/${slug}/page.js`);
		assert.ok(page.includes(`getHelpPageMetadata("${slug}")`), `${slug} names its own metadata`);
		assert.ok(page.includes(`<ArticleHelp slug="${slug}">`), `${slug} renders as its own article`);
	}
});

test("plans and the warm-up are MailCheap Cloud's only: a self-hosted server leaves them out", () => {
	const cloud = getHelpArticles({ MAILCHEAP_CLOUD: "true" }).map(({ slug }) => slug);
	const selfHosted = getHelpArticles({}).map(({ slug }) => slug);
	assert.deepEqual(cloud, HELP_ARTICLES.map(({ slug }) => slug));
	assert.deepEqual(
		cloud.filter((slug) => !selfHosted.includes(slug)),
		["warm-up", "plans"]
	);
});

test("every link into the help center opens one of its articles, at a section the article has", async () => {
	const files = [...(await listSources("app")), ...(await listSources("components"))];
	const links = [];
	for (const file of files) {
		const source = await readSource(file);
		for (const [, slug, section] of source.matchAll(/<LinkHelp\s+article="([^"]+)"(?:\s+section="([^"]+)")?/g)) links.push({ file, slug, section });
		for (const [, slug, section] of source.matchAll(/getHelpHref\("([^"]+)"(?:, "([^"]+)")?\)/g)) links.push({ file, slug, section });
		// A notice's help, handed to LinkHelp as { article, section }.
		for (const [, slug, section] of source.matchAll(/\{ article: "([^"]+)"(?:, section: "([^"]+)")? \}/g)) links.push({ file, slug, section });
	}
	assert.ok(links.some(({ file }) => file === "components/NoticePace.jsx"), "the pace notice links to its articles");
	assert.ok(links.some(({ file, slug, section }) => file === "components/LinkHelpFields.jsx" && slug === "contacts" && section === "fields"));
	for (const { file, slug, section } of links) {
		assert.ok(
			HELP_ARTICLES.some((article) => article.slug === slug),
			`${file} links to /help/${slug}`
		);
		if (section) assert.ok((await readSource(`${HELP_DIR}/${slug}/page.js`)).includes(`id="${section}"`), `${file} links to /help/${slug}#${section}`);
	}
});

test("every screenshot is a 1600×1000 WebP in its article's folder of public/help, with its alt and caption, and none is left over", async () => {
	const figures = [];
	for (const { slug } of HELP_ARTICLES) {
		const page = await readSource(`${HELP_DIR}/${slug}/page.js`);
		for (const [tag] of page.matchAll(/<FigureHelp\b[^>]*\/>/g)) {
			figures.push({ slug, ...Object.fromEntries([...tag.matchAll(/(\w+)="([^"]*)"/g)].map(([, name, value]) => [name, value])) });
		}
	}
	assert.ok(figures.length > 0);
	for (const { slug, src, alt, caption } of figures) {
		assert.match(src, new RegExp(`^/help/${slug}/[a-z-]+\\.webp$`), `${slug}: ${src}`);
		assert.ok(alt?.endsWith("."), `${src}: its alt is a sentence`);
		assert.ok(caption, `${src}: it has a caption`);
		const { format, width, height } = await sharp(join(ROOT, "public", src)).metadata();
		assert.deepEqual({ format, width, height }, { format: "webp", width: 1600, height: 1000 }, src);
	}
	const files = (await readdir(join(ROOT, "public/help"), { recursive: true })).filter((file) => /\.\w+$/.test(file));
	assert.deepEqual(files.map((file) => `/help/${file}`).sort(), figures.map(({ src }) => src).sort(), "each image in public/help shows once");
});

test("every list of the contact fields, and the dialog that makes them, links to how to add them", async () => {
	const lists = ["components/FormCampaign.jsx", "components/PickerReader.jsx", "components/DialogContactFields.jsx"];
	for (const file of lists) assert.match(await readSource(file), /<LinkHelpFields\b/, file);
	assert.match(await readSource("components/MenuSlash.jsx"), /<ChipAddField\b/, "the slash menu's end on Add a field");
	assert.match(await readSource("components/EditorRich.jsx"), /<DialogContactFields\b/, "which opens the dialog");
	const dialog = await readSource("components/DialogContactFields.jsx");
	assert.match(dialog, /between\s+double\s+braces/, "the dialog says how an email prints a field");
	assert.match(dialog, /<ButtonMergeTag tag=\{fieldTag\(field\.key\)\}/, "and shows each field's own, to copy");
});

test("every link from the help center and the docs into the dashboard opens a page the app has", async () => {
	const pages = await listAppPages();
	const files = [...(await listSources(HELP_DIR)), ...(await listSources("app/(site)/docs"))];
	const links = [];
	for (const file of files) {
		for (const [, href] of (await readSource(file)).matchAll(/<LinkApp\s+href=(?:"([^"]*)"|\{)/g)) links.push({ file, href });
	}
	assert.ok(links.length >= 30, "articles link to the dashboard pages they mention");
	assert.ok(links.some(({ href }) => href === "/domains") && links.some(({ href }) => href === "/newsletters/welcome"));
	for (const { file, href } of links) {
		assert.ok(href, `${file} gives LinkApp a literal path`);
		assert.ok(pages.has(href.replace(/[?#].*$/, "")), `${file} links to ${href}, which isn't a page of the app`);
	}
});

test("the help center never names an email provider", async () => {
	const files = [...(await listSources(HELP_DIR)), "components/ArticleHelp.jsx", "components/NavHelp.jsx", "lib/help.js"];
	for (const file of files) assert.doesNotMatch(await readSource(file), PROVIDERS, file);
});

test("the pace notice shows only when a send won't go out at once: its steps, with their numbers, and why", () => {
	const render = (props) => renderToStaticMarkup(createElement(NoticePace, props));
	const learnMore = (html) => html.match(/>Learn more</g)?.length ?? 0;

	assert.equal(render({ pace: { sender: null }, emails: 9335, newContacts: 0 }), "", "everyone emailed before, from a domain Gmail knows");
	assert.equal(render({ pace: { sender: null }, emails: 1000, newContacts: 200 }), "", "no more new contacts than the first step's minimum");

	const steps = render({ pace: { sender: null }, emails: 9335, newContacts: 9335 });
	assert.match(steps, /9,335 new contacts get it in 3 steps/);
	assert.match(steps, /200 first \(2%\)/);
	assert.match(steps, /467 more \(5%\), 30 minutes later/);
	assert.match(steps, /The other 8,668, 30 minutes after that/);
	assert.match(steps, /To keep your emails out of spam/, "and why");
	assert.match(steps, /It&#x27;s only the first time: your next issues go to them at once\./, "and when it stops");
	assert.equal(learnMore(steps), 1);
	assert.match(steps, /href="\/help\/sending#first-send"/);
	assert.doesNotMatch(steps, /Gmail/, "nothing about Gmail when it holds nothing back");

	const selfHosted = render({ pace: null, emails: 1000, newContacts: 1000 });
	assert.match(selfHosted, /1,000 new contacts get it in 3 steps/, "a self-hosted server sends in steps too");
	assert.doesNotMatch(selfHosted, /Gmail/);
});

test("from a new domain, the notice says how many Gmail readers get a send today and how many tomorrow, and how to skip it", () => {
	const render = (props) => renderToStaticMarkup(createElement(NoticePace, props));
	const fresh = {
		day: 1,
		intoDayMs: 0,
		waitMs: 0,
		firstDay: 2000,
		days: 1,
		isGradual: false,
		sentToday: 0,
		inFlight: 0,
		hasStarted: false,
		domain: "made-simple.example.org",
	};

	const shared = render({ pace: { sender: fresh }, emails: 9335, newContacts: 9335, gmailShare: 6103 / 9335, isSharedSender: true });
	assert.match(shared, /9,335 new contacts get it in 3 steps/);
	assert.match(shared, /Some Gmail readers get it tomorrow/, "Gmail in a part of its own");
	assert.equal(shared.match(/>Learn more</g)?.length, 2, "each part says why");
	assert.match(shared, /made-simple\.example\.org/);
	assert.match(shared, /s2\/favicons\?domain=made-simple\.example\.org/, "the domain has its favicon");
	assert.match(shared, /2,000 of your 6,103 Gmail readers today\./);
	assert.match(shared, /Next: the other 4,103 tomorrow\./);
	assert.match(shared, /Gmail is careful with the first emails from a new domain/);
	assert.match(shared, /href="\/domains"[^>]*>Add a domain</);
	assert.match(
		shared,
		/out of spam\. <a [^>]*>Add a domain<\/a> you already send newsletters with, and it all goes today\. <a [^>]*>Learn more<\/a><\/p>/,
		"in the same paragraph as why"
	);
	assert.doesNotMatch(shared, /new account|you&#x27;re new/i, "about the domain, never the customer");

	const own = render({ pace: { sender: fresh }, emails: 6000, newContacts: 0, gmailShare: 0.5 });
	assert.match(own, /Some Gmail readers get it tomorrow/);
	assert.match(own, /2,000 of your 3,000 Gmail readers today\./);
	assert.match(own, /href="\/help\/warm-up#new-domain"/);
	assert.doesNotMatch(own, /Add a domain/, "it's already a domain of their own");

	assert.equal(render({ pace: { sender: fresh }, emails: 3000, newContacts: 0, gmailShare: 0.5 }), "", "1,500 Gmail readers fit its first day");

	const restart = { ...fresh, firstDay: 300, days: 3, isGradual: true, waitMs: 4 * 3_600_000, hasStarted: true };
	const backingOff = render({ pace: { sender: restart }, emails: 1000, gmailShare: 1 });
	assert.match(backingOff, /Gmail gets it more slowly for now/);
	assert.match(backingOff, /Gmail gets it again in 4 hours: 300 of your Gmail readers that day\./);
	assert.match(backingOff, /Next: the other 700 over the next 2 days\./);
	assert.match(backingOff, /href="\/help\/warm-up#gmail"/);
});
