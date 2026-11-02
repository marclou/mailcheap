import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	SIGNUP_EVENT,
	getAnalyticsProblem,
	getWebsiteAnalytics,
	readAnalyticsField,
	readAnalyticsId,
	startWebsiteAnalytics,
	toAnalyticsDocument,
} from "../lib/website-analytics.js";

// The code each tool gives to paste on a site, as it gives it, with made-up IDs.
const GOOGLE_ANALYTICS_CODE = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-PSW1MY7HB4"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-PSW1MY7HB4');
</script>`;
const TAG_MANAGER_CODE = `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-ABCDEFGH');</script>
<!-- End Google Tag Manager -->`;
const TAG_MANAGER_BODY_CODE = `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-ABCDEFGH"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;
const META_PIXEL_CODE = `<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '123456789012345');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=123456789012345&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->`;

const IDS = { googleAnalytics: "G-PSW1MY7HB4", googleTagManager: "GTM-ABCDEFGH", metaPixel: "123456789012345" };

// A page's window as the tools see it: the host it's on, the scripts added to its head, and its events.
function fakeWindow({ hostname = "weekly.mailcheapmail.com", ...fields } = {}) {
	const scripts = [];
	const listeners = new Map();
	const w = {
		...fields,
		location: { hostname },
		document: { createElement: (tag) => ({ tag }), head: { appendChild: (element) => scripts.push(element) } },
		addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
		dispatch: (type) => listeners.get(type)?.forEach((listener) => listener()),
	};
	return { w, scripts };
}

// gtag.js only reads its commands as arguments objects; the rest are Tag Manager's data layer messages.
function readDataLayer(dataLayer) {
	return dataLayer.map((entry) =>
		Object.prototype.toString.call(entry) === "[object Arguments]"
			? ["gtag", ...[...entry].map((value) => (value instanceof Date ? "date" : value))]
			: entry
	);
}

describe("an ID, or the code a tool gives", () => {
	test("keeps the ID, uppercase, wherever it is in what was pasted", () => {
		assert.equal(readAnalyticsId("googleAnalytics", " g-psw1my7hb4 "), "G-PSW1MY7HB4");
		assert.equal(readAnalyticsId("googleAnalytics", GOOGLE_ANALYTICS_CODE), "G-PSW1MY7HB4");
		assert.equal(readAnalyticsId("googleTagManager", TAG_MANAGER_CODE), "GTM-ABCDEFGH");
		assert.equal(readAnalyticsId("googleTagManager", TAG_MANAGER_BODY_CODE), "GTM-ABCDEFGH", "the part for the body too");
		assert.equal(readAnalyticsId("metaPixel", META_PIXEL_CODE), "123456789012345");
		assert.equal(readAnalyticsId("metaPixel", '<img src="https://www.facebook.com/tr?id=1234567890123456&amp;ev=PageView">'), "1234567890123456");
		assert.equal(readAnalyticsId("googleAnalytics", "Measurement ID: G-PSW1MY7HB4"), "G-PSW1MY7HB4");
		assert.equal(readAnalyticsId("googleAnalytics", "UA-1234567-1"), "UA-1234567-1", "what holds no ID stays, for the check to name");
		assert.equal(readAnalyticsId("metaPixel", undefined), "");
		assert.deepEqual(toAnalyticsDocument({ googleAnalytics: GOOGLE_ANALYTICS_CODE, googleTagManager: "", metaPixel: META_PIXEL_CODE }), {
			googleAnalytics: "G-PSW1MY7HB4",
			metaPixel: "123456789012345",
		});
	});

	test("as a field changes, pasted code becomes its ID and what's typed stays", () => {
		assert.equal(readAnalyticsField("googleAnalytics", "g-psw"), "g-psw");
		assert.equal(readAnalyticsField("googleAnalytics", GOOGLE_ANALYTICS_CODE), "G-PSW1MY7HB4");
		assert.equal(readAnalyticsField("googleTagManager", TAG_MANAGER_CODE), "GTM-ABCDEFGH");
		assert.equal(readAnalyticsField("metaPixel", META_PIXEL_CODE), "123456789012345");
		assert.equal(readAnalyticsField("googleTagManager", GOOGLE_ANALYTICS_CODE), GOOGLE_ANALYTICS_CODE, "the wrong tool's code stays, to be refused");
	});

	test("each check says what's wrong and where the ID goes", () => {
		assert.equal(getAnalyticsProblem({ googleAnalytics: GOOGLE_ANALYTICS_CODE, googleTagManager: TAG_MANAGER_CODE, metaPixel: META_PIXEL_CODE }), null);
		assert.equal(getAnalyticsProblem({ googleAnalytics: "", googleTagManager: "", metaPixel: "" }), null);
		assert.equal(getAnalyticsProblem(undefined), null);
		assert.match(getAnalyticsProblem({ googleAnalytics: "UA-1234567-1" }), /GA4 measurement ID, which starts with G-\. UA- IDs are Universal Analytics'/);
		assert.equal(getAnalyticsProblem({ googleAnalytics: "GTM-ABCDEFGH" }), "That's a Tag Manager container ID: paste it under Tag Manager");
		assert.equal(getAnalyticsProblem({ googleAnalytics: TAG_MANAGER_CODE }), "That's a Tag Manager container ID: paste it under Tag Manager");
		assert.equal(getAnalyticsProblem({ googleAnalytics: "AW-123456789" }), "Google Analytics takes a measurement ID, which starts with G-");
		assert.equal(getAnalyticsProblem({ googleTagManager: GOOGLE_ANALYTICS_CODE }), "That's a Google Analytics measurement ID: paste it under Google Analytics");
		assert.equal(getAnalyticsProblem({ googleTagManager: "GTM-1" }), "Tag Manager takes a container ID, which starts with GTM-");
		assert.match(getAnalyticsProblem({ metaPixel: "12345" }), /the 15 or 16 digits under its name in Events Manager/);
		assert.match(getAnalyticsProblem({ metaPixel: TAG_MANAGER_CODE }), /Meta pixel takes its pixel ID/);
	});
});

describe("what the website loads", () => {
	const server = { host: "weekly.mailcheapmail.com", sharedDomain: "mailcheapmail.com", appHost: "app.mailcheapmail.com:443" };

	test("nothing without a tool, or while the website shares the dashboard's address", () => {
		assert.equal(getWebsiteAnalytics({ slug: "weekly" }, server), null);
		assert.equal(getWebsiteAnalytics({ slug: "weekly", analytics: { googleAnalytics: "" } }, server), null);
		assert.equal(getWebsiteAnalytics({ slug: "weekly", analytics: IDS }, { ...server, host: null }), null, "a server without a shared domain");
		assert.equal(getWebsiteAnalytics({ slug: "weekly", analytics: { metaPixel: "<script>alert(1)</script>" } }, server), null, "only an ID ever runs");
	});

	test("each tool by its ID, with the newsletter's own domain where they run as they come", () => {
		assert.deepEqual(getWebsiteAnalytics({ slug: "weekly", analytics: IDS }, server), { ...IDS, ownDomain: null });
		const own = { slug: "weekly", archiveHost: "news.example.com", analytics: { googleTagManager: "GTM-ABCDEFGH" } };
		assert.deepEqual(getWebsiteAnalytics(own, { ...server, host: "news.example.com" }), { googleTagManager: "GTM-ABCDEFGH", ownDomain: "news.example.com" });
	});

	test("only the website's own layout loads them, never the unsubscribe, confirm and keep pages its host also serves", async () => {
		const app = fileURLToPath(new URL("../app", import.meta.url));
		const files = (await readdir(app, { recursive: true })).filter((file) => /\.jsx?$/.test(file));
		const loaders = [];
		for (const file of files) if ((await readFile(join(app, file), "utf8")).includes("ScriptWebsiteAnalytics")) loaders.push(file);
		assert.deepEqual(loaders, [join("archive", "[slug]", "layout.js")]);
	});

	test("never a host of the shared domain or the app's, whatever the newsletter has", () => {
		for (const archiveHost of ["mailcheapmail.com", "other.mailcheapmail.com", "app.mailcheapmail.com", "a.app.mailcheapmail.com"]) {
			assert.equal(getWebsiteAnalytics({ slug: "weekly", archiveHost, analytics: IDS }, { ...server, host: archiveHost }).ownDomain, null, archiveHost);
		}
	});
});

describe("on the website's pages", () => {
	test("each tool loads from its own snippet, Tag Manager limited to Google's tags before its container loads", () => {
		const { w, scripts } = fakeWindow();
		startWebsiteAnalytics({ ...IDS, ownDomain: null }, w);
		assert.deepEqual(
			scripts.map(({ tag, src, async }) => [tag, src, async]),
			[
				["script", "https://www.googletagmanager.com/gtm.js?id=GTM-ABCDEFGH", true],
				["script", "https://www.googletagmanager.com/gtag/js?id=G-PSW1MY7HB4", true],
				["script", "https://connect.facebook.net/en_US/fbevents.js", true],
			]
		);
		const [limits, start, ...gtag] = readDataLayer(w.dataLayer);
		assert.deepEqual(limits["gtm.allowlist"], ["google"]);
		for (const blocked of ["customScripts", "customPixels", "nonGooglePixels", "nonGoogleScripts", "nonGoogleIframes", "k", "j"]) {
			assert.ok(limits["gtm.blocklist"].includes(blocked), blocked);
		}
		assert.equal(start.event, "gtm.js");
		assert.equal(typeof start["gtm.start"], "number");
		assert.deepEqual(gtag, [
			["gtag", "js", "date"],
			["gtag", "config", "G-PSW1MY7HB4", { cookie_domain: "weekly.mailcheapmail.com" }],
		]);
		assert.deepEqual(w.fbq.queue.map((call) => [...call]), [["init", "123456789012345"], ["track", "PageView"]]);
		assert.equal(w._fbq, w.fbq);
		assert.deepEqual([w.fbq.loaded, w.fbq.version], [true, "2.0"]);
	});

	test("each signup reaches every tool as its own event", () => {
		const { w } = fakeWindow();
		startWebsiteAnalytics({ ...IDS, ownDomain: null }, w);
		const before = w.dataLayer.length;
		w.dispatch(SIGNUP_EVENT);
		assert.deepEqual(readDataLayer(w.dataLayer.slice(before)), [["gtag", "event", "sign_up"], { event: "sign_up" }]);
		assert.deepEqual([...w.fbq.queue.at(-1)], ["track", "CompleteRegistration"]);
	});

	test("on its own domain, Tag Manager runs every tag and Google Analytics sets its cookie as it does on any site", () => {
		const { w } = fakeWindow({ hostname: "news.example.com" });
		startWebsiteAnalytics({ ...IDS, ownDomain: "news.example.com" }, w);
		assert.deepEqual(readDataLayer(w.dataLayer).slice(0, 1).map(({ event }) => event), ["gtm.js"], "no limits first");
		assert.deepEqual(readDataLayer(w.dataLayer).at(-1), ["gtag", "config", "G-PSW1MY7HB4", {}]);
	});

	test("with its own domain live, the same cached page on its shared address stays limited", () => {
		const { w } = fakeWindow({ hostname: "weekly.mailcheapmail.com" });
		startWebsiteAnalytics({ ...IDS, ownDomain: "news.example.com" }, w);
		const [limits] = readDataLayer(w.dataLayer);
		assert.deepEqual(limits["gtm.allowlist"], ["google"]);
		assert.deepEqual(readDataLayer(w.dataLayer).at(-1), ["gtag", "config", "G-PSW1MY7HB4", { cookie_domain: "weekly.mailcheapmail.com" }]);
	});

	test("a tool left out gets nothing, and a pixel already on the page isn't loaded twice", () => {
		const { w, scripts } = fakeWindow();
		startWebsiteAnalytics({ googleAnalytics: "G-PSW1MY7HB4", ownDomain: null }, w);
		w.dispatch(SIGNUP_EVENT);
		assert.deepEqual(scripts.map(({ src }) => src), ["https://www.googletagmanager.com/gtag/js?id=G-PSW1MY7HB4"]);
		assert.deepEqual(readDataLayer(w.dataLayer).at(-1), ["gtag", "event", "sign_up"], "no Tag Manager event without its container");
		assert.equal(w.fbq, undefined);

		const calls = [];
		const page = fakeWindow({ fbq: (...args) => calls.push(args) });
		startWebsiteAnalytics({ metaPixel: "123456789012345", ownDomain: null }, page.w);
		page.w.dispatch(SIGNUP_EVENT);
		assert.deepEqual(page.scripts, []);
		assert.deepEqual(calls, [["init", "123456789012345"], ["track", "PageView"], ["track", "CompleteRegistration"]]);
		assert.equal(page.w.gtag, undefined);
	});
});
