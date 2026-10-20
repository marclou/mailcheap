import { redirect } from "next/navigation";
import FormTheme from "@/components/FormTheme";
import HeaderPage from "@/components/HeaderPage";
import { DESIGN_SECTION, SETTINGS_PATH } from "@/lib/newsletter-sections";
import { scoped } from "@/lib/account-scope";
import { ADD_NEWSLETTER_PATH } from "@/lib/newsletters";
import { getPostalAddress } from "@/lib/postal-address";
import { getSelectedNewsletter } from "@/lib/selected-newsletter";
import { serialize } from "@/lib/serialize";
import { siteExtensions } from "@/lib/site-extensions";
import { THEME_FONTS, getFontFaceCss } from "@/lib/theme-fonts";
import Newsletter from "@/models/Newsletter";

export const metadata = { title: "Design" };

// Every preset's fonts load here for the previews; the dashboard has Geist already.
const FONT_FACES = getFontFaceCss(THEME_FONTS.filter((font) => font.id !== "geist"));

export default async function DesignPage() {
	const { account, selected } = await getSelectedNewsletter();
	if (!selected) redirect(ADD_NEWSLETTER_PATH);
	const newsletter = await Newsletter.findOne(scoped(account, { _id: selected._id }))
		.select({ name: 1, slug: 1, imageUrl: 1, description: 1, fromName: 1, fromEmail: 1, postalAddress: 1, postalAddressCleared: 1, theme: 1 })
		.lean();

	return (
		<div className="mx-auto w-full max-w-5xl">
			<style dangerouslySetInnerHTML={{ __html: FONT_FACES }} />
			<HeaderPage title={DESIGN_SECTION.label} backHref={SETTINGS_PATH} />
			<FormTheme
				key={String(newsletter._id)}
				newsletter={serialize(newsletter)}
				postalAddress={getPostalAddress(newsletter, siteExtensions.defaultPostalAddress)}
			/>
		</div>
	);
}
