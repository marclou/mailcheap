import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import AvatarContact from "@/components/AvatarContact";
import BadgeStatus from "@/components/BadgeStatus";
import CheckboxContact, { CheckboxAllContacts } from "@/components/CheckboxContact";
import MenuContact from "@/components/MenuContact";
import TextEmpty from "@/components/TextEmpty";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { contactFieldValues } from "@/lib/contact-fields";
import { UNDELIVERABLE_LABELS } from "@/lib/contact-status";
import { CONTACTS_PAGE_SIZE } from "@/lib/contacts";
import { formatDate, formatNumber } from "@/lib/format";
import { gravatarHash } from "@/lib/gravatar";

// A page of contacts, each opening its own page, with its menu, and a box to select it (ProviderContactSelection).
// fields: the account's own, which the menu edits.
export default function TableContacts({ contacts, fields }) {
	return (
		<div style={{ "--stagger": 1 }} className="overflow-hidden rounded-xl shadow-border animate-enter">
			<Table>
				<TableHeader>
					<TableRow className="hover:bg-transparent">
						<TableHead className="w-10 pl-4">
							<CheckboxAllContacts />
						</TableHead>
						<TableHead className="pl-3">Email</TableHead>
						<TableHead className="hidden md:table-cell">Tags</TableHead>
						<TableHead>Status</TableHead>
						<TableHead className="hidden text-right lg:table-cell">Opens</TableHead>
						<TableHead className="hidden text-right lg:table-cell">Clicks</TableHead>
						<TableHead className="hidden text-right sm:table-cell">Added</TableHead>
						<TableHead className="w-12 pr-2" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{contacts.map((contact) => (
						<TableRow key={contact._id.toString()} className="relative tabular-nums has-data-[state=checked]:bg-muted/70">
							<TableCell className="w-10 py-2.5 pl-4">
								<CheckboxContact id={contact._id.toString()} email={contact.email} />
							</TableCell>
							<TableCell className="w-full max-w-0 py-2.5 pl-3 font-medium sm:w-2/5">
								<span className="flex min-w-0 items-center gap-2.5">
									<AvatarContact email={contact.email} gravatarHash={gravatarHash(contact.email)} size={26} />
									<Link href={`/contacts/${contact._id}`} className="truncate after:absolute after:inset-0">
										{contact.email}
									</Link>
									{contact.firstName && (
										<span className="hidden max-w-40 truncate font-normal text-muted-foreground sm:inline">{contact.firstName}</span>
									)}
								</span>
							</TableCell>
							<TableCell className="hidden md:table-cell">
								<ListTags tags={contact.tags} />
							</TableCell>
							<TableCell>
								<BadgeStatus
									status={contact.status}
									label={contact.undeliverableAt && (UNDELIVERABLE_LABELS[contact.undeliverableReason] ?? "Undeliverable")}
								/>
							</TableCell>
							<TableCell className="hidden text-right lg:table-cell">{engagement(contact, "opens", "openRate")}</TableCell>
							<TableCell className="hidden text-right lg:table-cell">{engagement(contact, "clicks", "clickRate")}</TableCell>
							<TableCell className="hidden text-right text-muted-foreground sm:table-cell">
								{formatDate(contact.subscribedAt) ?? <TextEmpty />}
							</TableCell>
							<TableCell className="pr-2 text-right">
								<MenuContact
									id={contact._id.toString()}
									email={contact.email}
									status={contact.status}
									undeliverableReason={contact.undeliverableReason}
									firstName={contact.firstName ?? ""}
									tags={contact.tags ?? []}
									fields={contactFieldValues(contact, fields)}
								/>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

// Where this page starts and ends among total, and the pages around it. hrefFor(page): its address.
export function NavPages({ page, pageCount, total, hrefFor }) {
	if (pageCount <= 1) return null;
	return (
		<div className="flex items-center justify-between gap-3 text-sm text-muted-foreground tabular-nums">
			<span>
				{formatNumber((page - 1) * CONTACTS_PAGE_SIZE + 1)}–{formatNumber(Math.min(page * CONTACTS_PAGE_SIZE, total))} of{" "}
				{formatNumber(total)}
			</span>
			<div className="flex gap-1">
				<PageLink href={hrefFor(page - 1)} isDisabled={page <= 1} label="Previous">
					<ChevronLeft />
				</PageLink>
				<PageLink href={hrefFor(page + 1)} isDisabled={page >= pageCount} label="Next">
					<ChevronRight />
				</PageLink>
			</div>
		</div>
	);
}

// Two tags, then how many more.
function ListTags({ tags = [] }) {
	if (tags.length === 0) return <TextEmpty />;
	return (
		<span className="flex max-w-56 items-center gap-1">
			{tags.slice(0, 2).map((tag) => (
				<span key={tag} className="inline-flex h-5 min-w-0 items-center rounded-md bg-muted px-1.5 text-xs text-muted-foreground">
					<span className="truncate">{tag}</span>
				</span>
			))}
			{tags.length > 2 && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">+{tags.length - 2}</span>}
		</span>
	);
}

function PageLink({ href, isDisabled, label, children }) {
	if (isDisabled) {
		return (
			<Button variant="outline" size="icon" disabled aria-label={label}>
				{children}
			</Button>
		);
	}
	return (
		<Button asChild variant="outline" size="icon">
			<Link href={href} scroll={false} aria-label={label}>
				{children}
			</Link>
		</Button>
	);
}

function engagement(contact, statKey, importedKey) {
	if (contact.stats?.[statKey]) return formatNumber(contact.stats[statKey]);
	const rate = contact.imported?.[importedKey];
	return rate === undefined || rate === null ? <TextEmpty /> : `${Math.round(rate * 100)}%`;
}
