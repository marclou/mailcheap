import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import LayoutDashboard from "@/components/LayoutDashboard";
import { isAdmin, requireAccount } from "@/lib/auth";
import { needsOnboarding } from "@/lib/onboarding";
import { getSelectedNewsletter } from "@/lib/selected-newsletter";
import { rememberTimeZone } from "@/lib/summary-send";
import { OWNER_ROLE } from "@/lib/team-rules";
import { TIME_ZONE_COOKIE } from "@/lib/time-zone";

// Opens without a plan: what costs something (sending, imports, domains, API keys) shows the paywall.
// Billing lives in (account), outside this check. Someone who only works on newsletters shared with them skips the setup
// of their own.
export default async function AppLayout({ children }) {
	const { user } = await requireAccount();
	const { account, ownAccount, role } = await getSelectedNewsletter();
	if (role === OWNER_ROLE && (await needsOnboarding(ownAccount))) redirect("/welcome");
	const timeZone = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
	after(() => rememberTimeZone(ownAccount, timeZone).catch((error) => console.error("[summary] Could not save the timezone:", error.message)));

	return (
		<LayoutDashboard user={user} account={account} ownAccount={ownAccount} role={role} isAdmin={isAdmin(user)}>
			{children}
		</LayoutDashboard>
	);
}
