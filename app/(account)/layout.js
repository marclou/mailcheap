import LayoutDashboard from "@/components/LayoutDashboard";
import { isAdmin, requireAccount } from "@/lib/auth";
import { getSelectedNewsletter } from "@/lib/selected-newsletter";

// The account page and billing only need a sign-in, and skip the newsletter setup: plan links on the public pages
// lead to billing. They're the user's own account's, whichever newsletter is open; the sidebar follows the open one.
export default async function AccountLayout({ children }) {
	const { user, account } = await requireAccount();
	const { role } = await getSelectedNewsletter();

	return (
		<LayoutDashboard user={user} account={account} ownAccount={account} role={role} isAdmin={isAdmin(user)}>
			{children}
		</LayoutDashboard>
	);
}
