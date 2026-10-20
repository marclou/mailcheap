import { AtSign, BrushCleaning, CodeXml, Globe, Hand, MailCheck, Palette } from "lucide-react";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import CardSettingsSection from "@/components/CardSettingsSection";
import HeaderPage from "@/components/HeaderPage";
import LayoutNarrow from "@/components/LayoutNarrow";
import RedirectSettingsField from "@/components/RedirectSettingsField";
import { DESIGN_SECTION, FORM_SECTION, SETTINGS_SECTIONS, getSectionPath } from "@/lib/newsletter-sections";
import { getSettingsPage } from "@/lib/settings-page";
import { getDesignSummary, getSettingsSummary } from "@/lib/settings-summary";
import { getThemeSummary } from "@/lib/themes";

export const metadata = { title: "Settings" };

// The open newsletter's settings at a glance, a card for each section's page; /newsletters/<id> opens another one first.
export default async function SettingsPage() {
	const page = await getSettingsPage();
	const { newsletter } = page;
	const summary = getSettingsSummary(page);
	const design = getDesignSummary(getThemeSummary(newsletter));

	return (
		<LayoutNarrow>
			<RedirectSettingsField />
			<HeaderPage title="Settings" />
			<ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				{SETTINGS_SECTIONS.map(({ id, label }, index) => (
					<li key={id}>
						<CardSettingsSection
							href={getSectionPath(id)}
							icon={ICONS[id]}
							media={id === "general" ? <AvatarNewsletter newsletter={newsletter} size={40} /> : null}
							label={label}
							state={summary[id]}
							stagger={index + 1}
						/>
					</li>
				))}
				<li>
					<CardSettingsSection
						href={getSectionPath(FORM_SECTION.id)}
						icon={CodeXml}
						label={FORM_SECTION.label}
						state={summary.form}
						stagger={SETTINGS_SECTIONS.length + 1}
					/>
				</li>
				<li>
					<CardSettingsSection
						href={getSectionPath(DESIGN_SECTION.id)}
						icon={Palette}
						label={DESIGN_SECTION.label}
						state={design}
						swatches={design.swatches}
						stagger={SETTINGS_SECTIONS.length + 2}
					/>
				</li>
			</ul>
		</LayoutNarrow>
	);
}

const ICONS = { sender: AtSign, signups: MailCheck, welcome: Hand, cleanup: BrushCleaning, website: Globe };
