import FormNewsletter from "@/components/FormNewsletter";
import HeaderPage from "@/components/HeaderPage";
import LayoutNarrow from "@/components/LayoutNarrow";
import { getFieldOptions } from "@/lib/contact-fields";
import { SETTINGS_PARENT, getSection } from "@/lib/newsletter-sections";
import { serialize } from "@/lib/serialize";

// A section's page of the open newsletter's settings (lib/newsletter-sections.js), back to the overview. page: what
// lib/settings-page.js loaded for it. The form starts over for each newsletter: its fields keep what they were given
// when it first rendered. authors: the Sender page's (FormNewsletter).
export default function LayoutSettingsSection({ section, page, preselectDomain = null, authors = null }) {
	const { newsletter } = page;

	return (
		<LayoutNarrow>
			<HeaderPage title={getSection(section).label} parent={SETTINGS_PARENT} />
			<FormNewsletter
				key={String(newsletter._id)}
				section={section}
				newsletter={serialize(newsletter)}
				domains={serialize(page.domains)}
				sharedDomain={page.sharedDomain}
				appUrl={page.appUrl}
				hasArchiveHost={page.hasArchiveHost}
				websiteDomain={serialize(page.websiteDomain)}
				hasSentIssue={page.hasSentIssue}
				defaultPostalAddress={page.defaultPostalAddress}
				isSendingEnabled={page.isSendingEnabled}
				testRecipients={page.testRecipients}
				cleanupTotals={page.cleanupTotals}
				welcomePause={page.welcomePause}
				signupReviews={page.signupReviews}
				contactFields={getFieldOptions(page.account)}
				isCloud={page.isCloud}
				preselectDomain={preselectDomain}
				authors={authors}
			/>
		</LayoutNarrow>
	);
}
