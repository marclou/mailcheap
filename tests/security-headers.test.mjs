import assert from "node:assert/strict";
import { test } from "node:test";
import nextConfig from "../next.config.mjs";
import { formatActivity } from "../lib/activity.js";

// A path's headers as Next.js gives them: every rule whose source matches, a later one winning on the same header.
async function getHeaders(path) {
	const headers = new Headers();
	for (const rule of await nextConfig.headers()) {
		if (!matches(rule.source, path)) continue;
		for (const { key, value } of rule.headers) headers.set(key, value);
	}
	return headers;
}

// The two kinds of sources next.config uses: /:path(<regex>) and <base>/:path*.
function matches(source, path) {
	const custom = source.match(/^\/:path\((.*)\)$/);
	if (custom) return new RegExp(`^/(?:${custom[1]})$`).test(path);
	if (!source.endsWith("/:path*")) return source === path;
	const base = source.slice(0, -"/:path*".length);
	return path === base || path.startsWith(`${base}/`);
}

test("every response carries the CSP, HSTS and framing headers", async () => {
	const headers = await getHeaders("/contacts");
	const policy = Object.fromEntries(
		headers
			.get("content-security-policy")
			.split(";")
			.map((directive) => directive.trim().split(/\s+/))
			.map(([name, ...values]) => [name, values.join(" ")])
	);
	assert.deepEqual(policy, {
		"frame-ancestors": "'none'",
		"object-src": "'none'",
		"base-uri": "'self'",
		"form-action": "'self'",
		"script-src-attr": "'none'",
	});
	assert.equal(headers.get("strict-transport-security"), "max-age=63072000; includeSubDomains");
	assert.equal(headers.get("x-frame-options"), "DENY");
	assert.equal(headers.get("x-content-type-options"), "nosniff");
	assert.equal((await getHeaders("/embed.js")).get("x-frame-options"), "DENY", "the embed script is not a frame");
});

test("only the signup form for other sites can be framed, by any site, with the rest of the policy", async () => {
	for (const path of ["/embed/64f1a2b3c4d5e6f7a8b9c0b1", "/embed/64f1a2b3c4d5e6f7a8b9c0b1/done"]) {
		const headers = await getHeaders(path);
		const policy = headers.get("content-security-policy");
		assert.ok(policy.includes("frame-ancestors *"), path);
		assert.ok(!policy.includes("frame-ancestors 'none'"), path);
		assert.ok(policy.includes("form-action 'self'") && policy.includes("script-src-attr 'none'"), path);
		assert.equal(headers.get("x-frame-options"), null, path);
		assert.equal(headers.get("strict-transport-security"), "max-age=63072000; includeSubDomains");
		assert.equal(headers.get("x-content-type-options"), "nosniff");
	}
	assert.ok((await getHeaders("/embedded")).get("content-security-policy").includes("frame-ancestors 'none'"));
});

test("activity alerts name the IP, the country and, for logins, the browser", () => {
	assert.equal(
		formatActivity(["New login"], { ip: "203.0.113.5", country: "NL", userAgent: "Mozilla/5.0 Safari" }),
		"New login\nIP 203.0.113.5 (NL)\nMozilla/5.0 Safari"
	);
	assert.equal(
		formatActivity(["API key created: Signup form", "https://app.example.com/api-keys"], { ip: "unknown", country: null }),
		"API key created: Signup form\nhttps://app.example.com/api-keys\nIP unknown"
	);
	assert.equal(formatActivity(["New login"], { ip: "198.51.100.1", userAgent: "" }), "New login\nIP 198.51.100.1\nNo user agent");
	const long = formatActivity(["New login"], { ip: "198.51.100.1", userAgent: "x".repeat(500) });
	assert.equal(long.split("\n")[2].length, 160);
});
