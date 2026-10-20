// What MailCheap Cloud's marketing site shows on shared pages, resolved like lib/site-extensions.js (to
// components/marketing/SiteExtensions.jsx). The open source has none of them: each is null and renders nothing.
// SiteAnalytics also counts the steps shared markup names with data-goal attributes. SupportChat, the chat on signed-in
// dashboard pages, opens in place from links to siteExtensions.supportChatPath and renders [data-support-chat]. WhatsNew,
// on dashboard pages too, gets the account and shows what shipped since its owner last looked. ArticleUpsell ends the
// help center's and the docs' pages; ArticleDemo gets a help article's slug and opens it with the feature's picture.
export const SiteAnalytics = null;
export const SiteBand = null;
export const ArticleUpsell = null;
export const ArticleDemo = null;
export const SigninAside = null;
export const FooterCredit = null;
export const FooterNote = null;
export const PricingNote = null;
export const SupportChat = null;
export const WhatsNew = null;
