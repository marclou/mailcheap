import Link from "next/link";
import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { switchAccount } from "@/app/join/actions";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import ButtonSignout from "@/components/ButtonSignout";
import FormJoinTeam from "@/components/FormJoinTeam";
import LogoMailcheap from "@/components/LogoMailcheap";
import { Button } from "@/components/ui/button";
import { isDeletionPending } from "@/lib/account-state";
import { getCurrentAccount } from "@/lib/auth";
import { findInvitation, isSameInbox } from "@/lib/team";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, getJoinPath } from "@/lib/team-rules";

export const metadata = { title: "Join a newsletter's team", robots: { index: false, follow: false } };

// Where an invitation's email leads (lib/team.js). Signing in with the address it went to proves it's theirs; joining
// opens the newsletter in the dashboard.
export default async function JoinPage({ params }) {
	const { token } = await params;
	const current = await getCurrentAccount();
	if (!current) redirect(`/signin?next=${encodeURIComponent(getJoinPath(token))}`);
	if (isDeletionPending(current.account)) redirect("/restore");
	const invitation = await findInvitation(token);
	if (!invitation || invitation.isExpired) return <Invalid />;
	const { member, newsletter, ownerEmail } = invitation;
	const isTheirs = isSameInbox(current.user.email, member.email);

	return (
		<main className="flex min-h-dvh items-center justify-center px-4 py-16">
			<div className="w-full max-w-sm animate-enter">
				<div className="mb-7 flex flex-col items-center gap-4 text-center">
					<AvatarNewsletter newsletter={newsletter} size={48} />
					<div className="flex flex-col gap-1">
						<h1 className="text-lg font-semibold tracking-tight text-balance">Join {newsletter.name}</h1>
						<p className="text-sm text-pretty text-muted-foreground">
							{ownerEmail} invited you to work on it with them, as {member.role === "admin" ? "an admin" : "a member"}.
						</p>
					</div>
				</div>

				<div className="overflow-hidden rounded-xl shadow-border">
					<div className="flex gap-2.5 p-4 text-sm text-pretty text-muted-foreground">
						<Check className="mt-0.5 size-4 shrink-0 text-foreground" />
						<p>
							<span className="font-medium text-foreground">{ROLE_LABELS[member.role]}: </span>
							{ROLE_DESCRIPTIONS[member.role]}
						</p>
					</div>
					<form action={switchAccount} className="flex items-center justify-between gap-3 border-t border-border/60 bg-muted/40 px-4 py-2.5">
						<input type="hidden" name="token" value={token} />
						<p className="min-w-0 truncate text-sm">
							<span className="text-muted-foreground">Signed in as </span>
							<span className="font-medium">{current.user.email}</span>
						</p>
						<ButtonSignout className="shrink-0">Switch</ButtonSignout>
					</form>
				</div>

				<div className="mt-6">
					{isTheirs ? (
						<FormJoinTeam token={token} newsletterName={newsletter.name} />
					) : (
						<p className="text-center text-sm text-pretty text-muted-foreground">
							This invitation is for <span className="font-medium text-foreground">{member.email}</span>. Switch to sign in with that address and join.
						</p>
					)}
				</div>
			</div>
		</main>
	);
}

function Invalid() {
	return (
		<main className="flex min-h-dvh items-center justify-center px-4 py-16">
			<div className="flex w-full max-w-xs flex-col items-center gap-3 text-center animate-enter">
				<LogoMailcheap className="size-10" />
				<h1 className="text-lg font-semibold tracking-tight">This invitation isn&apos;t valid anymore</h1>
				<p className="text-sm text-pretty text-muted-foreground">
					It was used, canceled or it expired. Ask whoever invited you to send a new one.
				</p>
				<Button asChild variant="outline" className="mt-2">
					<Link href="/">Open MailCheap</Link>
				</Button>
			</div>
		</main>
	);
}
