// The analytics tools a newsletter's website can load (its Website settings, update_newsletter's analytics). Each is saved
// as its ID alone and runs from the snippet written here, so nothing its owner pastes runs as code. name: as the settings
// and the help center call it.
export const ANALYTICS_TOOLS = [
	{ key: "googleAnalytics", name: "Google Analytics", example: "G-XXXXXXXXXX" },
	{ key: "googleTagManager", name: "Tag Manager", example: "GTM-XXXXXXX" },
	{ key: "metaPixel", name: "Meta pixel", example: "123456789012345" },
];
// What the API takes for each tool: its ID, or the code the tool gives to paste, a few lines long.
export const ANALYTICS_INPUT_MAX_LENGTH = 5000;
// What the website's signup forms send once someone subscribes (components/FormSubscribe.jsx).
export const SIGNUP_EVENT = "mailcheap:signup";

const ID_PATTERNS = {
	googleAnalytics: /^G-[A-Z0-9]{4,16}$/,
	googleTagManager: /^GTM-[A-Z0-9]{4,12}$/,
	metaPixel: /^\d{10,20}$/,
};
// Where each tool's own code has its ID: Google's in its script's URL and its gtag or Tag Manager call, Meta's in
// fbq("init") and its noscript image.
const CODE_PATTERNS = {
	googleAnalytics: /\bG-[A-Z0-9]{4,16}\b/i,
	googleTagManager: /\bGTM-[A-Z0-9]{4,12}\b/i,
	metaPixel: /fbq\(\s*["']init["']\s*,\s*["']?(\d{10,20})|[?&](?:amp;)?id=(\d{10,20})/,
};
const ID_PROBLEMS = {
	googleAnalytics: (text) => {
		if (/\bUA-\d/i.test(text)) {
			return "Google Analytics takes a GA4 measurement ID, which starts with G-. UA- IDs are Universal Analytics', which no longer collects data";
		}
		if (CODE_PATTERNS.googleTagManager.test(text)) return "That's a Tag Manager container ID: paste it under Tag Manager";
		return "Google Analytics takes a measurement ID, which starts with G-";
	},
	googleTagManager: (text) =>
		CODE_PATTERNS.googleAnalytics.test(text)
			? "That's a Google Analytics measurement ID: paste it under Google Analytics"
			: "Tag Manager takes a container ID, which starts with GTM-",
	metaPixel: () => "The Meta pixel takes its pixel ID, the 15 or 16 digits under its name in Events Manager",
};

// Anywhere but the newsletter's own domain, Tag Manager runs Google's own tags only. Custom HTML, custom templates and
// other companies' tags would run an owner's code on the shared domain, next to every other newsletter's website and, on
// MailCheap Cloud, the dashboard. Its First Party Cookie (k) and JavaScript Variable (j) variables would read the cookies
// set for all of the domain.
const TAG_MANAGER_LIMITS = {
	"gtm.allowlist": ["google"],
	"gtm.blocklist": ["customScripts", "customPixels", "nonGooglePixels", "nonGoogleScripts", "nonGoogleIframes", "k", "j"],
};

// A tool's ID, uppercase, wherever it is in what was pasted; else the text as it came, for the check to name.
export function readAnalyticsId(key, value) {
	const text = String(value ?? "").trim();
	if (ID_PATTERNS[key].test(text.toUpperCase())) return text.toUpperCase();
	const match = CODE_PATTERNS[key].exec(text);
	return match ? (match[1] ?? match[2] ?? match[0]).toUpperCase() : text;
}

// As a field changes: pasted code becomes the ID in it, and what's typed stays as it is.
export function readAnalyticsField(key, value) {
	return /[\s<>()"']/.test(value.trim()) ? readAnalyticsId(key, value) : value;
}

export function toAnalyticsSettings(analytics) {
	return Object.fromEntries(ANALYTICS_TOOLS.map(({ key }) => [key, analytics?.[key] ?? ""]));
}

// The IDs to save; a tool without one is left out.
export function toAnalyticsDocument(analytics) {
	return Object.fromEntries(ANALYTICS_TOOLS.map(({ key }) => [key, readAnalyticsId(key, analytics?.[key])]).filter(([, id]) => id));
}

export function getAnalyticsProblem(analytics) {
	for (const { key } of ANALYTICS_TOOLS) {
		const id = readAnalyticsId(key, analytics?.[key]);
		if (id && !ID_PATTERNS[key].test(id)) return ID_PROBLEMS[key](id);
	}
	return null;
}

// What the newsletter's website loads, or null without a tool. None without a host (lib/archive-hosts.js), while the
// website shares the dashboard's address (a server without a shared domain): the tools would go on running on the
// dashboard's pages after a link there, Tag Manager's as whoever is signed in. ownDomain: where the tools run as they
// come (getOwnDomain).
export function getWebsiteAnalytics(newsletter, { host, sharedDomain, appHost }) {
	const ids = Object.fromEntries(Object.entries(toAnalyticsDocument(newsletter?.analytics)).filter(([key, id]) => ID_PATTERNS[key].test(id)));
	if (!host || Object.keys(ids).length === 0) return null;
	return { ...ids, ownDomain: getOwnDomain(newsletter, { sharedDomain, appHost }) };
}

// The newsletter's own domain, its live website domain, where its tools and its own code run as they come. Never a host
// of the shared domain or of the app's, whatever the newsletter has.
export function getOwnDomain(newsletter, { sharedDomain, appHost }) {
	const archiveHost = newsletter?.archiveHost;
	const isUnder = (domain) => Boolean(domain) && (archiveHost === domain || archiveHost.endsWith(`.${domain}`));
	return archiveHost && !isUnder(sharedDomain) && !isUnder(appHost?.split(":")[0]) ? archiveHost : null;
}

// Each tool's snippet as it documents it, in the website's pages (components/ScriptWebsiteAnalytics.jsx). A signup there
// reaches each one as its own event: sign_up for Google Analytics and in Tag Manager's data layer, CompleteRegistration
// for the Meta pixel. The pages are cached for every host they're served on, so the page says which it's on: anywhere
// but its own domain, its address on the shared domain included, Tag Manager is limited and Google Analytics keeps its
// cookie on the page's host, where the domain's other websites and the dashboard don't get it.
export function startWebsiteAnalytics({ googleAnalytics, googleTagManager, metaPixel, ownDomain }, w = window) {
	const { hostname } = w.location;
	const isOwnDomain = Boolean(ownDomain) && hostname === ownDomain;
	const load = (src) => {
		const script = w.document.createElement("script");
		script.async = true;
		script.src = src;
		w.document.head.appendChild(script);
	};
	w.dataLayer = w.dataLayer || [];
	if (googleTagManager) {
		if (!isOwnDomain) w.dataLayer.push(TAG_MANAGER_LIMITS);
		w.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
		load(`https://www.googletagmanager.com/gtm.js?id=${googleTagManager}`);
	}
	if (googleAnalytics) {
		// gtag.js only reads its commands as arguments objects.
		w.gtag =
			w.gtag ||
			function gtag() {
				w.dataLayer.push(arguments);
			};
		w.gtag("js", new Date());
		w.gtag("config", googleAnalytics, isOwnDomain ? {} : { cookie_domain: hostname });
		load(`https://www.googletagmanager.com/gtag/js?id=${googleAnalytics}`);
	}
	if (metaPixel && !w.fbq) {
		const fbq = function () {
			if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments);
			else fbq.queue.push(arguments);
		};
		w._fbq = w._fbq || fbq;
		Object.assign(fbq, { push: fbq, loaded: true, version: "2.0", queue: [] });
		w.fbq = fbq;
		load("https://connect.facebook.net/en_US/fbevents.js");
	}
	if (metaPixel) {
		w.fbq("init", metaPixel);
		w.fbq("track", "PageView");
	}
	w.addEventListener(SIGNUP_EVENT, () => {
		if (googleAnalytics) w.gtag("event", "sign_up");
		if (googleTagManager) w.dataLayer.push({ event: "sign_up" });
		if (metaPixel) w.fbq("track", "CompleteRegistration");
	});
}
