import FormNewsletter from "@/components/FormNewsletter";
import HeaderPage from "@/components/HeaderPage";
import LayoutNarrow from "@/components/LayoutNarrow";
import { SETTINGS_PATH, getSection } from "@/lib/newsletter-sections";
import { serialize } from "@/lib/serialize";

// A section's page of the open newsletter's settings (lib/newsletter-sections.js), back to the overview. page: what
// lib/settings-page.js loaded for it. The form starts over for each newsletter: its fields keep what they were given
// when it first rendered.
export default function LayoutSettingsSection({ section, page }) {
	const { newsletter } = page;

	return (
		<LayoutNarrow>
			<HeaderPage title={getSection(section).label} backHref={SETTINGS_PATH} />
			<FormNewsletter
				key={String(newsletter._id)}
				section={section}
				newsletter={serialize(newsletter)}
				domains={serialize(page.domains)}
				sharedDomain={page.sharedDomain}
				appUrl={page.appUrl}
				hasArchiveHost={page.hasArchiveHost}
				hasSentIssue={page.hasSentIssue}
				defaultPostalAddress={page.defaultPostalAddress}
				isSendingEnabled={page.isSendingEnabled}
				testEmail={page.user.email}
				cleanupTotals={page.cleanupTotals}
				welcomePause={page.welcomePause}
				isCloud={page.isCloud}
			/>
		</LayoutNarrow>
	);
}
