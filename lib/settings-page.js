import "server-only";
import { redirect } from "next/navigation";
import { scoped } from "@/lib/account-scope";
import { areWelcomeEmailsPaused, getWelcomePauseNotice, hasActiveSubscription } from "@/lib/account-state";
import { hasPublishedIssue } from "@/lib/archive-data";
import { cleanupTotalsPipeline } from "@/lib/cleanup";
import { getAppUrl, getArchiveCnameTarget, getSharedDomain, isCloud, isSendingEnabled } from "@/lib/config";
import { ADD_NEWSLETTER_PATH } from "@/lib/newsletters";
import { findAccountDomains } from "@/lib/sender";
import { requireRole } from "@/lib/selected-newsletter";
import { getSignupEmailReviewStatuses } from "@/lib/signup-email-review";
import { siteExtensions } from "@/lib/site-extensions";
import { isSpamListEnabled } from "@/lib/domain-reputation";
import { countStoppedContacts } from "@/lib/stopped-contacts";
import { getUsage } from "@/lib/usage";
import { getWebsiteDomainSetup } from "@/lib/website-domain-rules";
import Contact from "@/models/Contact";
import Newsletter from "@/models/Newsletter";

// The open newsletter's settings, for the overview and each section's page; /newsletters/<id> opens another one first.
// section: a page's own extras, the cleanup totals, the welcome pause notice, whether the content check holds the
// newsletter's own welcome, confirmation or last-chance email (signupReviews), and the website domain's setup.
export async function getSettingsPage({ section = null } = {}) {
	const { user, account, selected, role } = await requireRole("admin");
	if (!selected) redirect(ADD_NEWSLETTER_PATH);
	const [newsletter, domains, hasSentIssue, cleanupTotals, welcomePause] = await Promise.all([
		Newsletter.findOne(scoped(account, { _id: selected._id })).lean(),
		findAccountDomains(account._id),
		hasPublishedIssue({ accountId: account._id, _id: selected._id }),
		section === "cleanup" ? getCleanupTotals(account, selected._id) : null,
		section === "welcome" ? getWelcomePause(account) : null,
	]);
	const hasSignupEmail = newsletter && ["welcome", "signups", "cleanup"].includes(section);
	const cnameTarget = getArchiveCnameTarget();
	return {
		user,
		account,
		role,
		newsletter,
		domains,
		hasSentIssue,
		cleanupTotals,
		welcomePause,
		signupReviews: hasSignupEmail ? await getSignupEmailReviewStatuses(newsletter) : null,
		hasPlan: hasActiveSubscription(account),
		isWelcomePaused: areWelcomeEmailsPaused(account),
		sharedDomain: getSharedDomain(),
		appUrl: getAppUrl(),
		hasArchiveHost: Boolean(cnameTarget),
		websiteDomain: section === "website" && newsletter ? getWebsiteDomainSetup(newsletter, { accountId: account._id, cnameTarget }) : null,
		defaultPostalAddress: siteExtensions.defaultPostalAddress,
		isSendingEnabled: isSendingEnabled(),
		isCloud: isCloud(),
	};
}

async function getCleanupTotals(account, newsletterId) {
	const [[totals], stopped] = await Promise.all([
		Contact.aggregate(cleanupTotalsPipeline({ accountId: account._id, newsletterId })),
		countStoppedContacts({ accountId: account._id, newsletterId }),
	]);
	return { waiting: totals?.waiting ?? 0, kept: totals?.kept ?? 0, dormant: totals?.dormant ?? 0, ...stopped, isSpamListOn: isSpamListEnabled() };
}

async function getWelcomePause(account) {
	const usage = await getUsage(account);
	return usage.welcomeEmailsPaused ? getWelcomePauseNotice(usage) : null;
}
