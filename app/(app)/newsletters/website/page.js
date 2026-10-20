import LayoutSettingsSection from "@/components/LayoutSettingsSection";
import { getSettingsPage } from "@/lib/settings-page";

export const metadata = { title: "Website" };

export default async function WebsitePage() {
	return <LayoutSettingsSection section="website" page={await getSettingsPage({ section: "website" })} />;
}
