import { Check } from "lucide-react";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import AvatarUser from "@/components/AvatarUser";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/team-rules";

// Sign-in's right side for someone a team invitation brought there (lib/team.js), in place of the dashboard's demo: the
// newsletter they're about to join, who invited them and what their role lets them do. inviter: { name, email, image,
// gravatarHash }.
export default function AsideInvitation({ newsletter, inviter, role }) {
	return (
		<div className="absolute inset-0 flex items-center px-12 py-16 xl:px-16">
			<div className="w-full max-w-md">
				<p className="font-display text-[2rem] leading-[1.1] font-[480] tracking-[-0.025em] text-balance animate-enter">
					You&apos;re invited to work on {newsletter.name}
				</p>
				<div
					style={{ "--stagger": 1 }}
					className="mt-8 overflow-hidden rounded-2xl bg-card shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_32px_64px_-32px_rgb(0_0_0/0.28)] animate-enter dark:shadow-[0_0_0_1px_rgb(255_255_255/0.07),0_32px_64px_-32px_rgb(0_0_0/0.9)]"
				>
					<div className="flex items-center gap-4 p-6">
						<AvatarNewsletter newsletter={newsletter} size={56} className="rounded-xl" />
						<div className="min-w-0">
							<p className="truncate text-lg font-semibold tracking-tight">{newsletter.name}</p>
							<p className="text-sm text-muted-foreground">Joining as {role === "admin" ? "an admin" : "a member"}</p>
						</div>
					</div>
					<div className="flex items-center gap-3 border-t border-border/60 px-6 py-4">
						<AvatarUser name={inviter.name} email={inviter.email} image={inviter.image} gravatarHash={inviter.gravatarHash} size={32} />
						<p className="min-w-0 text-sm">
							<span className="block truncate font-medium">{inviter.name ?? inviter.email}</span>
							<span className="block truncate text-muted-foreground">invited you{inviter.name ? `, from ${inviter.email}` : ""}</span>
						</p>
					</div>
					<div className="flex gap-3 border-t border-border/60 bg-muted/30 px-6 py-4">
						<Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
						<p className="text-sm text-pretty text-muted-foreground">
							<span className="font-medium text-foreground">{ROLE_LABELS[role]}: </span>
							{ROLE_DESCRIPTIONS[role]}
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
