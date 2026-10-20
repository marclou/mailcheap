import LayoutSettingsSection from "@/components/LayoutSettingsSection";
import { getSettingsPage } from "@/lib/settings-page";

export const metadata = { title: "Sender" };

export default async function SenderPage() {
	return <LayoutSettingsSection section="sender" page={await getSettingsPage({ section: "sender" })} />;
}
