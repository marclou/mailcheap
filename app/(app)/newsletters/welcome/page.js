import LayoutSettingsSection from "@/components/LayoutSettingsSection";
import { getSettingsPage } from "@/lib/settings-page";

export const metadata = { title: "Welcome email" };

export default async function WelcomePage() {
	return <LayoutSettingsSection section="welcome" page={await getSettingsPage({ section: "welcome" })} />;
}
