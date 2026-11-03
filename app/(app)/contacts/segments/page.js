import Link from "next/link";
import { ChartPie, ChevronRight, Plus } from "lucide-react";
import DialogSegment from "@/components/DialogSegment";
import HeaderPage from "@/components/HeaderPage";
import LinkHelp from "@/components/LinkHelp";
import StateEmpty from "@/components/StateEmpty";
import { Button } from "@/components/ui/button";
import { getFieldOptions } from "@/lib/contact-fields";
import { formatNumber, formatRate } from "@/lib/format";
import { countActivity, listLiveSegments } from "@/lib/segment-queries";
import { ACTIVITY_DAYS, compileSegment, describeSegment } from "@/lib/segments";
import { getSelectedNewsletter } from "@/lib/selected-newsletter";
import { hasRole } from "@/lib/team-rules";

export const metadata = { title: "Segments" };

// The open newsletter's segments: the active contacts each picks now, their share of the list, and how many of them
// opened lately.
export default async function SegmentsPage() {
	const { account, selected, role } = await getSelectedNewsletter();
	const newsletterId = selected ? String(selected._id) : null;
	// Segments are the newsletter's admins' to make.
	const canCreate = hasRole(role, "admin");
	const segments = newsletterId ? await listLiveSegments(account, newsletterId) : [];
	const [list, ...activities] = newsletterId
		? await Promise.all([null, ...segments].map((segment) => countActivity(account, newsletterId, segment && compileSegment(segment))))
		: [];
	const fields = getFieldOptions(account);
	const newSegment = newsletterId && canCreate && (
		<DialogSegment
			newsletterId={newsletterId}
			trigger={
				<Button>
					<Plus data-icon="inline-start" />
					New segment
				</Button>
			}
		/>
	);

	return (
		<>
			<HeaderPage title="Segments" parent={{ label: "Contacts", href: "/contacts" }}>
				{segments.length > 0 && newSegment}
			</HeaderPage>

			{segments.length === 0 ? (
				<StateEmpty icon={ChartPie} title="No segments yet">
					<p className="max-w-sm text-sm text-pretty text-muted-foreground">
						A segment picks contacts by what they do or who they are, like those who opened lately, and stays up to date.
						Send a campaign to one, or see how its people read. <LinkHelp article="contacts" section="segments" />
					</p>
					{newSegment}
				</StateEmpty>
			) : (
				<ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
					{segments.map((segment, index) => (
						<li key={String(segment._id)} style={{ "--stagger": index }} className="animate-enter">
							<CardSegment
								id={String(segment._id)}
								name={segment.name}
								description={describeSegment(segment, fields)}
								activity={activities[index]}
								listContacts={list.contacts}
							/>
						</li>
					))}
				</ul>
			)}
		</>
	);
}

function CardSegment({ id, name, description, activity, listContacts }) {
	const share = listContacts > 0 ? activity.contacts / listContacts : 0;
	return (
		<Link
			href={`/contacts/segments/${id}`}
			className="group flex h-full flex-col gap-4 rounded-xl p-4 shadow-border outline-none transition-[background-color,scale] duration-150 ease-out hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]"
		>
			<span className="flex flex-col gap-1">
				<span className="flex items-center justify-between gap-2">
					<span className="truncate font-medium">{name}</span>
					<ChevronRight
						aria-hidden="true"
						className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-hover:translate-x-0.5"
					/>
				</span>
				<span className="line-clamp-2 text-sm text-pretty text-muted-foreground">{description}</span>
			</span>
			<span className="mt-auto flex flex-col gap-2.5">
				<span className="flex items-end justify-between gap-3 tabular-nums">
					<span className="flex flex-col">
						<span className="text-2xl leading-tight font-semibold tracking-tight">{formatNumber(activity.contacts)}</span>
						<span className="text-xs text-muted-foreground">
							{listContacts > 0 ? `${formatRate(activity.contacts, listContacts, 0)} of your list` : "Active contacts"}
						</span>
					</span>
					{activity.contacts > 0 && (
						<span className="flex flex-col text-right">
							<span className="text-sm font-medium">{formatRate(activity.opened, activity.contacts, 0)}</span>
							<span className="text-xs text-muted-foreground">opened in {ACTIVITY_DAYS} days</span>
						</span>
					)}
				</span>
				<span
					role="meter"
					aria-label="Share of your list"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(share * 100)}
					className="block h-1 overflow-hidden rounded-full bg-muted"
				>
					<span
						className="block h-full rounded-full bg-foreground/70"
						style={{ width: `${Math.max(Math.min(share, 1) * 100, share > 0 ? 2 : 0)}%` }}
					/>
				</span>
			</span>
		</Link>
	);
}
