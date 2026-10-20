import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ERRORS } from "@/lib/actions/errors";
import { getAppUrl } from "@/lib/config";
import { DOC_PAGES } from "@/lib/docs/llms";
import { getMcpClients, getMcpConnectors } from "@/lib/docs/mcp-clients";
import { getEndpoints } from "@/lib/docs/reference";
import { getHelpArticles, getHelpHref } from "@/lib/help";

// What search (lib/search.js) looks through: each help article and its sections, the docs' pages, endpoints and MCP tools,
// error codes and assistants' setups. Built once at build time (app/search-index.json), from the articles' own source, so
// a section added there is found without another list to keep. Cloud-only articles stay out on a self-hosted server.
const HELP_DIR = "app/(site)/help";
const KEYWORDS_LENGTH = 480;

export async function buildSearchIndex({ env = process.env, appUrl = getAppUrl(), root = process.cwd() } = {}) {
	const articles = await Promise.all(
		getHelpArticles(env).map(async (article) => [article, await readFile(join(root, HELP_DIR, article.slug, "page.js"), "utf8")])
	);
	return [
		...articles.flatMap(([article, source]) => [
			{ group: "help", title: article.title, parent: article.group, text: article.summary, keywords: article.description, href: getHelpHref(article.slug) },
			...getSections(source).map(({ id, title, text }) => ({
				group: "help",
				title,
				parent: article.title,
				text: cut(text, KEYWORDS_LENGTH),
				href: getHelpHref(article.slug, id),
			})),
		]),
		...DOC_PAGES.map(({ href, title, summary, description }) => ({ group: "api", title, parent: "API and MCP", text: summary, keywords: description, href })),
		...getEndpoints(appUrl).map(({ name, slug, title, description, group, method, path }) => ({
			group: "api",
			title,
			parent: group,
			text: description,
			keywords: `${method} ${path} ${name}`,
			href: `/docs/api#${slug}`,
		})),
		...Object.entries(ERRORS).map(([code, { status, description }]) => ({
			group: "api",
			title: code,
			parent: "Errors",
			text: description,
			keywords: `${status} error`,
			href: `/docs/errors#${code}`,
		})),
		...[...getMcpConnectors(appUrl), ...getMcpClients(appUrl)].map(({ id, name }) => ({
			group: "api",
			title: `Connect ${name}`,
			parent: "MCP",
			text: `Set up ${name} with MailCheap's MCP server.`,
			href: `/docs/mcp#${id}`,
		})),
	];
}

// An article's sections: each h2 with its id, and the text up to the next one.
export function getSections(source) {
	const headings = [...source.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)];
	return headings.map((heading, index) => {
		const end = headings[index + 1]?.index ?? source.lastIndexOf("</ArticleHelp>");
		return { id: heading[1], title: toText(heading[2]), text: toText(source.slice(heading.index + heading[0].length, end)) };
	});
}

// The words a reader sees in a piece of JSX. An expression keeps the JSX it renders and its sentences in quotes ({" "},
// {isCloud() && " Needs a plan."}); a value it prints, like a number from a constant, shows as an ellipsis.
export function toText(jsx) {
	let text = jsx.replace(/\$\{[^{}]*\}/g, "…");
	for (let pass = 0; pass < 10 && /\{[^{}]*\}/.test(text); pass++) {
		text = text.replace(/\{([^{}]*)\}/g, (_, expression) => {
			const markup = expression.match(/<[\s\S]*>/)?.[0];
			if (markup) return ` ${markup} `;
			const quoted = [...expression.matchAll(/"([^"]*)"|`([^`]*)`/g)].map(([, double, template]) => double ?? template);
			if (quoted.length > 0) return ` ${quoted.filter((part) => /\s/.test(part)).join(" ")} `;
			return expression.trim() ? "…" : " ";
		});
	}
	return decodeEntities(text.replace(/<[^>]*>/g, " "))
		.replace(/\s+([.,;:!])/g, "$1")
		.replace(/(^|\s)[()?:&|]+(?=\s|$)/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function decodeEntities(text) {
	const entities = { apos: "'", quot: '"', amp: "&", lt: "<", gt: ">", ldquo: "\u201c", rdquo: "\u201d", nbsp: " " };
	return text.replace(/&(\w+);/g, (entity, name) => entities[name] ?? entity);
}

function cut(text, length) {
	if (text.length <= length) return text;
	return text.slice(0, text.lastIndexOf(" ", length));
}
