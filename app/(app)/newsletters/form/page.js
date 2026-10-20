import { redirect } from "next/navigation";
import FormEmbed from "@/components/FormEmbed";
import HeaderPage from "@/components/HeaderPage";
import LayoutNarrow from "@/components/LayoutNarrow";
import { scoped } from "@/lib/account-scope";
import { getAppUrl } from "@/lib/config";
import { FORM_SECTION, SETTINGS_PATH } from "@/lib/newsletter-sections";
import { ADD_NEWSLETTER_PATH } from "@/lib/newsletters";
import { getSelectedNewsletter } from "@/lib/selected-newsletter";
import { serialize } from "@/lib/serialize";
import Newsletter from "@/models/Newsletter";

export const metadata = { title: FORM_SECTION.label };

export default async function FormPage() {
	const { account, selected } = await getSelectedNewsletter();
	if (!selected) redirect(ADD_NEWSLETTER_PATH);
	const newsletter = await Newsletter.findOne(scoped(account, { _id: selected._id }))
		.select({ name: 1, description: 1, theme: 1, requireConfirmation: 1, "welcome.enabled": 1, signupForm: 1 })
		.lean();

	return (
		<LayoutNarrow>
			<HeaderPage title={FORM_SECTION.label} backHref={SETTINGS_PATH} />
			<FormEmbed key={String(newsletter._id)} newsletter={serialize(newsletter)} appUrl={getAppUrl()} />
		</LayoutNarrow>
	);
}
