import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ROOT_URL = pathToFileURL(ROOT).href;
const stub = (name) => new URL(`../stubs/${name}`, import.meta.url).href;

const STUBS = {
	"server-only": stub("empty.mjs"),
	"next/headers": stub("next-headers.mjs"),
	"next/headers.js": stub("next-headers.mjs"),
	"next/cache": stub("next-cache.mjs"),
	"next/navigation": stub("next-navigation.mjs"),
	"next/server": stub("next-server.mjs"),
	"next/link": stub("next-link.mjs"),
	"next/image": stub("next-image.mjs"),
	"next/font/google": stub("next-font-google.mjs"),
	"@vercel/blob": stub("vercel-blob.mjs"),
	"@aws-sdk/client-s3": stub("s3.mjs"),
	"@aws-sdk/client-cloudfront": stub("cloudfront.mjs"),
	"@upstash/qstash": stub("qstash.mjs"),
	"@upstash/qstash/nextjs": stub("qstash-nextjs.mjs"),
	"@better-auth/cimd/node": stub("cimd-node.mjs"),
	"botid/server": stub("botid-server.mjs"),
	"@/lib/ses": stub("ses.mjs"),
	"@/lib/dns-check": stub("dns-check.mjs"),
	"@/lib/mail-domains": stub("mail-domains.mjs"),
	"@/lib/dns-broker": stub("dns-broker.mjs"),
	"@/lib/remote-image": stub("remote-image.mjs"),
};

// MailCheap Cloud's marketing site extends the shared pages through this module where its file exists, as in
// next.config.mjs. The open source has none, so the default stays.
const SITE_EXTENSIONS = { "@/lib/site-extensions": "lib/marketing/site-extensions.js" };

const EXTENSIONS = ["", ".js", ".jsx", ".mjs", "/index.js"];

function isFile(path) {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function resolveAlias(specifier) {
	const base = `${ROOT}${specifier.slice(2)}`;
	const path = EXTENSIONS.map((extension) => `${base}${extension}`).find(isFile);
	return path ? pathToFileURL(path).href : null;
}

export async function resolve(specifier, context, nextResolve) {
	if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
	// The share images render for real; next/og has no exports map, so only its file name resolves.
	if (specifier === "next/og") return nextResolve("next/og.js", context);
	const extension = SITE_EXTENSIONS[specifier] && `${ROOT}${SITE_EXTENSIONS[specifier]}`;
	if (extension && isFile(extension)) return { url: pathToFileURL(extension).href, shortCircuit: true };
	if (specifier.startsWith("@/")) {
		const url = resolveAlias(specifier);
		if (url) return { url, shortCircuit: true };
	}
	return nextResolve(specifier, context);
}

// Components, pages, layouts and share images are JSX, which Node doesn't read: SWC, the compiler next build uses,
// turns it into react/jsx-runtime calls. Stylesheets load as nothing.
const JSX_FILE = /\.jsx$|\/app\/(.*\/)?(page|layout|opengraph-image)\.js$/;
let swc;

export async function load(url, context, nextLoad) {
	if (!url.startsWith(ROOT_URL) || url.includes("/node_modules/")) return nextLoad(url, context);
	if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true };
	if (!JSX_FILE.test(url)) return nextLoad(url, context);
	swc ??= loadSwc();
	const source = await readFile(new URL(url), "utf8");
	const { code } = await (await swc).transform(source, {
		filename: fileURLToPath(url),
		jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2022" },
		module: { type: "es6" },
	});
	return { format: "module", source: code, shortCircuit: true };
}

async function loadSwc() {
	const swcModule = createRequire(import.meta.url)("next/dist/build/swc/index.js");
	await swcModule.loadBindings();
	return swcModule;
}
