import { EMBED_BOTID_PATH, FIRST_NAME_PLACEHOLDER, escapeHtml, getSignupFormHeading } from "./signup-form.js";
import { getFontFaceCss, getFontStack } from "./theme-fonts.js";
import { getEmailTheme, resolveTheme } from "./themes.js";

// The pages of the signup form for other sites (lib/signup-form.js), as whole documents: the form in its frame, also
// the dashboard's preview, and where the plain HTML form lands. No React and no app styles: they load on other sites,
// so they stay small. Fonts come from /fonts on the server's own host. The frame reports its height to the page that
// holds it (public/embed.js) and leaves its background clear, so the site shows through: its color scheme follows that
// page's, since browsers paint a frame whose scheme differs from its page's on an opaque backdrop.

const SHADOWS = {
	none: ({ border }) => `0 0 0 1px ${border}`,
	soft: ({ border }) => `0 0 0 1px ${border},0 1px 2px -1px rgb(0 0 0/0.08),0 2px 6px 0 rgb(0 0 0/0.05)`,
	lifted: ({ border }) => `0 0 0 1px ${border},0 14px 30px -14px rgb(0 0 0/0.3)`,
	hard: ({ text }) => `0 0 0 2px ${text},4px 4px 0 0 ${text}`,
};
const PADDINGS = { compact: 16, comfortable: 20, spacious: 24 };
const ICONS = {
	check: '<path d="M20 6 9 17l-5-5"/>',
	mail: '<path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z"/><path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10"/>',
	alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
};

function icon(name) {
	return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

function getLook(theme) {
	const resolved = resolveTheme(theme);
	const { background, text, accent } = resolved.colors;
	const { card, border, mutedText, onAccent, ring } = resolved.palette;
	const { radius } = getEmailTheme(resolved);
	const isDark = resolved.scheme === "dark";
	return {
		background,
		text,
		accent,
		card,
		border,
		mutedText,
		onAccent,
		ring,
		error: isDark ? "#fca5a5" : "#b91c1c",
		control: `${radius.button}px`,
		box: `${radius.box}px`,
		shadow: SHADOWS[resolved.shadow]({ border, text }),
		isHardShadow: resolved.shadow === "hard",
		padding: PADDINGS[resolved.spacing],
		headingWeight: resolved.headingWeight,
		tracking: `${resolved.tracking}em`,
		faces: getFontFaceCss([resolved.fonts.body, resolved.fonts.heading]),
		body: getFontStack(resolved.fonts.body),
		heading: getFontStack(resolved.fonts.heading),
	};
}

function getBaseCss(look) {
	return `${look.faces}*,*::before,*::after{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;font-family:${look.body};color:${look.text};-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}a{color:inherit}.mc-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:44px;padding:0 18px;font:inherit;font-size:15px;font-weight:600;line-height:1;white-space:nowrap;text-decoration:none;color:${look.onAccent};background:${look.accent};border:0;border-radius:${look.control};cursor:pointer;transition:opacity .15s ease,transform .15s ease}.mc-button:hover{opacity:.9}.mc-button:active{transform:scale(.97)}.mc-button:focus-visible{outline:2px solid ${look.ring};outline-offset:2px}.mc-muted{color:${look.mutedText}}@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}`;
}

function toDocument({ title, css, body }) {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${css}</style></head><body>${body}</body></html>`;
}

// Tells the page holding the frame how tall it is, now and after every change.
const HEIGHT_SCRIPT = `const report=()=>parent.postMessage({type:"mailcheap:height",height:Math.ceil(document.documentElement.getBoundingClientRect().height)},"*");new ResizeObserver(report).observe(document.documentElement);report();`;

// The form in its frame. token: from lib/signup-form-token.js, empty in the preview, which signs no one up and shows what a
// reader sees next. newsletter: its name, description, theme and requireConfirmation. botId: whether its post proves a
// browser sent it, on Vercel only (lib/bot-check.js).
export function renderFormPage({ newsletter, settings, endpoint, token = "", isPreview = false, botId = false }) {
	const look = getLook(newsletter.theme);
	const isCard = settings.layout === "card";
	const previewState = newsletter.requireConfirmation ? "pending" : "subscribed";
	const { headline, subheadline } = getSignupFormHeading(settings, newsletter);
	const header = isCard
		? `${headline ? `<h1 class="mc-title">${escapeHtml(headline)}</h1>` : ""}${subheadline ? `<p class="mc-description mc-muted">${escapeHtml(subheadline)}</p>` : ""}`
		: "";
	const css = `${getBaseCss(look)}:root{color-scheme:light dark}body{background:transparent}.mc{padding:${isCard ? (look.isHardShadow ? "2px 6px 6px 2px" : "2px") : "3px"}}${
		isCard
			? `.mc-card{padding:${look.padding}px;background:${look.background};border-radius:${look.box};box-shadow:${look.shadow}}.mc-title{margin:0;font-family:${look.heading};font-size:19px;font-weight:${look.headingWeight};letter-spacing:${look.tracking};line-height:1.25;text-wrap:balance}.mc-description{margin:0;font-size:14.5px;line-height:1.5;text-wrap:pretty}.mc-title+.mc-description{margin-top:6px}${header ? ".mc-card form,.mc-card .mc-done{margin-top:16px}" : ""}`
			: ""
	}.mc-row{display:flex;flex-wrap:wrap;gap:8px}.mc-input{flex:1 1 200px;min-width:0;height:44px;padding:0 14px;font:inherit;font-size:16px;color:${look.text};background:${look.card};border:1px solid ${look.border};border-radius:${look.control};outline:none;transition:border-color .15s ease,box-shadow .15s ease}.mc-name{flex-basis:100%}.mc-input::placeholder{color:${look.mutedText};opacity:1}.mc-input:focus{border-color:${look.ring};box-shadow:0 0 0 3px color-mix(in srgb,${look.ring} 30%,transparent)}.mc-row .mc-button{flex:0 0 auto}.mc-button:disabled{opacity:.55;cursor:default;transform:none}.mc-error{display:flex;align-items:center;gap:6px;margin:8px 0 0;font-size:14px;line-height:1.4;color:${look.error}}.mc-error svg{flex:none}.mc-trap{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}.mc-done{display:flex;align-items:flex-start;gap:12px;font-size:15px;line-height:1.5}.mc-badge{display:grid;flex:none;place-items:center;width:28px;height:28px;margin-top:-2px;color:${look.accent};background:color-mix(in srgb,${look.accent} 14%,transparent);border-radius:999px}.mc-done strong{display:block;font-weight:600}.mc-done p{margin:2px 0 0}.mc-done .mc-button{height:38px;margin-top:10px;font-size:14px}.mc-note{margin:8px 0 0;font-size:13px}.mc-enter{animation:mc-enter .3s cubic-bezier(.2,.8,.2,1)}@keyframes mc-enter{from{opacity:0;transform:translateY(4px)}}`;
	const nameInput = settings.askFirstName
		? `<input class="mc-input mc-name" type="text" name="first_name" autocomplete="given-name" placeholder="${FIRST_NAME_PLACEHOLDER}" aria-label="First name">`
		: "";
	const body = `<main class="mc"><div class="${isCard ? "mc-card" : ""}">${header}<form action="${escapeHtml(endpoint)}" method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><div class="mc-trap" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div><div class="mc-row">${nameInput}<input class="mc-input" type="email" name="email" required autocomplete="email" placeholder="${escapeHtml(settings.placeholder)}" aria-label="Email"><button class="mc-button" type="submit">${escapeHtml(settings.buttonText)}</button></div><p class="mc-error" role="alert" hidden>${icon("alert")}<span></span></p></form><div class="mc-done mc-enter" data-done="subscribed" role="status" hidden><span class="mc-badge">${icon("check")}</span><div><strong>You&#39;re in</strong><p class="mc-muted">The next issue lands in your inbox.</p></div></div><div class="mc-done mc-enter" data-done="pending" role="status" hidden><span class="mc-badge">${icon("mail")}</span><div><strong>Check your inbox</strong><p class="mc-muted">Click the link we sent to <span data-email></span> to confirm. Until you do, you won&#39;t get a single issue.</p><a class="mc-button" data-inbox target="_blank" rel="noopener noreferrer" hidden></a><p class="mc-note mc-muted">Not there? Look in Promotions or Spam.</p></div></div></div></main>${botId && !isPreview ? getBotIdScript(endpoint) : ""}<script>${HEIGHT_SCRIPT}${getFormScript({ isPreview, previewState })}</script>`;
	return toDocument({ title: `Subscribe to ${newsletter.name}`, css, body });
}

// Vercel BotID's browser code wraps fetch, so the form's post carries its proof. A module runs once the page has loaded:
// long before anyone has typed an address, and the form's script calls fetch only then.
function getBotIdScript(endpoint) {
	return `<script type="module">import{initBotId}from"${EMBED_BOTID_PATH}";initBotId({protect:[{path:${JSON.stringify(endpoint)},method:"POST"}]});</script>`;
}

function getFormScript({ isPreview, previewState }) {
	return `(()=>{const form=document.querySelector("form");const button=form.querySelector("button");const error=form.querySelector(".mc-error");const fail=(message)=>{error.lastChild.textContent=message||"Something went wrong. Try again.";error.hidden=false;button.disabled=false;};const show=(state,email,inbox)=>{form.hidden=true;const done=document.querySelector('[data-done="'+state+'"]');done.hidden=false;const target=done.querySelector("[data-email]");if(target)target.textContent=email;const link=done.querySelector("[data-inbox]");if(link&&inbox&&/^https:\\/\\//.test(inbox.url)){link.href=inbox.url;link.textContent="Open "+inbox.name;link.hidden=false;}};form.addEventListener("submit",async(event)=>{event.preventDefault();error.hidden=true;const data=Object.fromEntries(new FormData(form));${
		isPreview
			? `show(${JSON.stringify(previewState)},data.email,null);`
			: `button.disabled=true;try{const response=await fetch(form.action,{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify(data)});const result=await response.json();if(result.ok)return show(result.pending?"pending":"subscribed",data.email,result.inbox);fail(result.error);}catch{fail();}`
	}});})();`;
}

// Where the plain HTML form lands: what happened, in the newsletter's theme, and the way back to the site.
// done: from readDoneToken, or null for a link that expired or was changed.
export function renderDonePage({ newsletter, done }) {
	const look = getLook(newsletter.theme);
	const content = getDoneContent(newsletter, done);
	const back = done?.back ? new URL(done.back) : null;
	const css = `${getBaseCss(look)}body{display:grid;min-height:100vh;place-items:center;padding:24px;background:${look.background}}.mc-box{width:100%;max-width:400px;padding:28px;text-align:center;background:${look.card};border-radius:${look.box};box-shadow:${look.shadow}}.mc-name{margin:0;font-size:13px;font-weight:500;letter-spacing:.01em}.mc-badge{display:grid;place-items:center;width:44px;height:44px;margin:18px auto 0;color:${look.accent};background:color-mix(in srgb,${look.accent} 14%,transparent);border-radius:999px}.mc-badge svg{width:20px;height:20px}h1{margin:14px 0 0;font-family:${look.heading};font-size:22px;font-weight:${look.headingWeight};letter-spacing:${look.tracking};line-height:1.25;text-wrap:balance}.mc-text{margin:8px 0 0;font-size:15px;line-height:1.55;text-wrap:pretty}.mc-box .mc-button{width:100%;margin-top:20px}.mc-back{display:inline-block;margin-top:16px;font-size:14px;text-underline-offset:3px}`;
	const inbox = done?.inbox && /^https:\/\//.test(done.inbox.url) ? done.inbox : null;
	const body = `<main class="mc-box"><p class="mc-name mc-muted">${escapeHtml(newsletter.name)}</p><span class="mc-badge">${icon(content.icon)}</span><h1>${escapeHtml(content.title)}</h1><p class="mc-text mc-muted">${escapeHtml(content.text)}</p>${
		inbox ? `<a class="mc-button" href="${escapeHtml(inbox.url)}" target="_blank" rel="noopener noreferrer">Open ${escapeHtml(inbox.name)}</a>` : ""
	}${back ? `<a class="mc-back mc-muted" href="${escapeHtml(back.href)}">Back to ${escapeHtml(back.hostname.replace(/^www\./, ""))}</a>` : ""}</main>`;
	return toDocument({ title: `${content.title} · ${newsletter.name}`, css, body });
}

function getDoneContent(newsletter, done) {
	if (done?.result === "pending") {
		return {
			icon: "mail",
			title: "Check your inbox",
			text: "Click the link we just sent you to confirm. Until you do, you won't get a single issue.",
		};
	}
	if (done?.result === "subscribed") {
		return { icon: "check", title: "You're in", text: `The next issue of ${newsletter.name} lands in your inbox.` };
	}
	return { icon: "alert", title: "That didn't work", text: done?.message ?? "This page expired. Go back and sign up again." };
}

// In the frame when there's no form to show: off, not on this site or gone. One quiet line, so the site stays tidy.
export function renderNoticePage(message) {
	const css = `body{margin:0;background:transparent;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#71717a}p{margin:0;padding:3px}`;
	return toDocument({ title: "Signup form", css, body: `<p>${escapeHtml(message)}</p><script>${HEIGHT_SCRIPT}</script>` });
}
