import Link from "next/link";
import { Archive, ChevronRight, Hand, MailCheck, Newspaper, Plus } from "lucide-react";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import HeaderPage from "@/components/HeaderPage";
import StateEmpty from "@/components/StateEmpty";
import { Button } from "@/components/ui/button";
import { listNewslettersWithActiveCounts } from "@/lib/contacts";
import { formatNumber } from "@/lib/format";

export const metadata = { title: "Newsletters" };

export default async function NewslettersPage() {
	const newsletters = await listNewslettersWithActiveCounts();

	return (
		<>
			<HeaderPage title="Newsletters">
				<Button asChild>
					<Link href="/newsletters/new">
						<Plus data-icon="inline-start" />
						New
					</Link>
				</Button>
			</HeaderPage>

			{newsletters.length === 0 ? (
				<StateEmpty icon={Newspaper} title="No newsletters yet">
					<Button asChild variant="outline">
						<Link href="/newsletters/new">Create a newsletter</Link>
					</Button>
				</StateEmpty>
			) : (
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{newsletters.map((newsletter, index) => (
						<Link
							key={newsletter._id.toString()}
							href={`/newsletters/${newsletter._id}`}
							style={{ "--stagger": index }}
							className="group flex flex-col gap-6 rounded-xl bg-card p-4 shadow-border transition-shadow duration-150 hover:shadow-border-hover animate-enter"
						>
							<div className="flex items-start justify-between gap-3">
								<div className="flex min-w-0 items-center gap-3">
									<AvatarNewsletter newsletter={newsletter} size={44} />
									<div className="min-w-0">
										<p className="truncate font-medium">{newsletter.name}</p>
										<p className="truncate text-sm text-muted-foreground">{newsletter.fromEmail}</p>
									</div>
								</div>
								<ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
							</div>
							<div className="flex items-end justify-between gap-3">
								<div>
									<p className="text-2xl font-semibold tracking-tight tabular-nums">
										{formatNumber(newsletter.activeCount)}
									</p>
									<p className="text-xs text-muted-foreground">active contacts</p>
								</div>
								<div className="flex gap-1.5">
									{newsletter.requireConfirmation ? (
										<Chip icon={MailCheck}>Confirmation</Chip>
									) : (
										newsletter.welcome?.enabled && <Chip icon={Hand}>Welcome</Chip>
									)}
									{newsletter.archiveEnabled && <Chip icon={Archive}>Archive</Chip>}
								</div>
							</div>
						</Link>
					))}
				</div>
			)}
		</>
	);
}

function Chip({ icon: Icon, children }) {
	return (
		<span className="inline-flex h-6 items-center gap-1 rounded-full bg-muted pr-2 pl-1.5 text-xs text-muted-foreground">
			<Icon className="size-3" />
			{children}
		</span>
	);
}
