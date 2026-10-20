import LayoutSettingsSection from "@/components/LayoutSettingsSection";
import { getSettingsPage } from "@/lib/settings-page";

export const metadata = { title: "List cleanup" };

export default async function CleanupPage() {
	return <LayoutSettingsSection section="cleanup" page={await getSettingsPage({ section: "cleanup" })} />;
}
