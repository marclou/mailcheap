import LayoutSettingsSection from "@/components/LayoutSettingsSection";
import { getSettingsPage } from "@/lib/settings-page";

export const metadata = { title: "Confirm signups" };

export default async function SignupsPage() {
	return <LayoutSettingsSection section="signups" page={await getSettingsPage({ section: "signups" })} />;
}
