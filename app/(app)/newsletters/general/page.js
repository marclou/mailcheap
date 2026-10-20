import LayoutSettingsSection from "@/components/LayoutSettingsSection";
import { getSettingsPage } from "@/lib/settings-page";

export const metadata = { title: "General" };

export default async function GeneralPage() {
	return <LayoutSettingsSection section="general" page={await getSettingsPage({ section: "general" })} />;
}
