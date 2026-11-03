import { AtSign, Bell, BrushCleaning, CodeXml, Globe, Hand, MailCheck, Palette, UsersRound } from "lucide-react";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import CardSettingsSection from "@/components/CardSettingsSection";
import HeaderPage from "@/components/HeaderPage";
import LayoutNarrow from "@/components/LayoutNarrow";
import RedirectSettingsField from "@/components/RedirectSettingsField";
import { DESIGN_SECTION, FORM_SECTION, NOTIFICATIONS_SECTION, SETTINGS_SECTIONS, TEAM_SECTION, getSectionPath } from "@/lib/newsletter-sections";
import { getSettingsPage } from "@/lib/settings-page";
import { getDesignSummary, getSettingsSummary, getTeamSummary } from "@/lib/settings-summary";
import { listTeam } from "@/lib/team";
import { OWNER_ROLE } from "@/lib/team-rules";
import { getThemeSummary } from "@/lib/themes";

export const metadata = { title: "Settings" };

// The open newsletter's settings at a glance, a card for each section's page; /newsletters/<id> opens another one first.
// Its team and the owner's notifications are the owner's alone.
export default async function SettingsPage() {
	const page = await getSettingsPage();
	const { newsletter } = page;
	const summary = getSettingsSummary(page);
	const design = getDesignSummary(getThemeSummary(newsletter));
	const isOwner = page.role === OWNER_ROLE;
	const team = isOwner ? await listTeam(page.account, newsletter._id) : null;
	const ownerCards = [
		team && { ...TEAM_SECTION, icon: UsersRound, state: getTeamSummary(team) },
		isOwner && page.isCloud && { ...NOTIFICATIONS_SECTION, icon: Bell, state: summary.notifications },
	].filter(Boolean);

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
				{ownerCards.map(({ id, label, icon, state }, index) => (
					<li key={id}>
						<CardSettingsSection href={getSectionPath(id)} icon={icon} label={label} state={state} stagger={SETTINGS_SECTIONS.length + 3 + index} />
					</li>
				))}
			</ul>
		</LayoutNarrow>
	);
}

const ICONS = { sender: AtSign, signups: MailCheck, welcome: Hand, cleanup: BrushCleaning, website: Globe };
