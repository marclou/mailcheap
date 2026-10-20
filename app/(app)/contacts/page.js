import crypto from "node:crypto";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import AvatarContact from "@/components/AvatarContact";
import BadgeStatus from "@/components/BadgeStatus";
import ButtonExportContacts from "@/components/ButtonExportContacts";
import CardAddContacts from "@/components/CardAddContacts";
import CardImports from "@/components/CardImports";
import DialogAddContact from "@/components/DialogAddContact";
import DialogContactFields from "@/components/DialogContactFields";
import DialogImportContacts from "@/components/DialogImportContacts";
import FilterContacts from "@/components/FilterContacts";
import GatePlan from "@/components/GatePlan";
import HeaderPage from "@/components/HeaderPage";
import ListSegments from "@/components/ListSegments";
import MenuContact from "@/components/MenuContact";
import MenuTagContacts from "@/components/MenuTagContacts";
import ProviderContactOptions from "@/components/ProviderContactOptions";
import StateEmpty from "@/components/StateEmpty";
import TextEmpty from "@/components/TextEmpty";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { scoped } from "@/lib/account-scope";
import { getAppUrl } from "@/lib/config";
import { cleanTag, contactFieldValues } from "@/lib/contact-fields";
import { CONTACTS_PAGE_SIZE, findContactsPage, listContactTags } from "@/lib/contacts";
import { getAddContactCurl } from "@/lib/docs/reference";
import { formatDate, formatNumber } from "@/lib/format";
import { listImports } from "@/lib/import-jobs";
import { toNewsletterOption } from "@/lib/newsletters";
import { countSegmentCards, listLiveSegments } from "@/lib/segment-queries";
import { compileSegment, describeSegment } from "@/lib/segments";
import { getSelectedNewsletter, openNewsletter } from "@/lib/selected-newsletter";
import { cn } from "@/lib/utils";
import Contact, { CONTACT_STATUSES } from "@/models/Contact";

export const metadata = { title: "Contacts" };

// The open newsletter's contacts. A newsletter in ?newsletter=, from the filter this page had, opens first. ?segment=
// narrows the list to one of its segments, ?tag= to the contacts with a tag.
export default async function ContactsPage({ searchParams }) {
	const [view, params] = await Promise.all([getSelectedNewsletter(), searchParams]);
	openNewsletter(view, params.newsletter, "/contacts");
	const { account, selected } = view;
	const newsletterId = selected ? String(selected._id) : null;
	const status = CONTACT_STATUSES.includes(params.status) ? params.status : null;
	const query = typeof params.q === "string" ? params.q.trim().toLowerCase().slice(0, 254) : "";
	const tag = typeof params.tag === "string" ? cleanTag(params.tag) : null;
	const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
	const fields = (account.contactFields ?? []).map(({ key, label, type }) => ({ key, label, type }));
	const segments = newsletterId ? await listLiveSegments(account, newsletterId) : [];
	const segment = segments.find(({ _id }) => String(_id) === params.segment) ?? null;
	const segmentId = segment ? String(segment._id) : null;

	const [{ contacts, counts, totalAll, total }, cardCounts, tags, imports] = newsletterId
		? await Promise.all([
				findContactsPage(account, { newsletterId, status, query, tag, page, segmentFilter: segment && { $and: [compileSegment(segment)] } }),
				countSegmentCards(account, newsletterId, segments),
				listContactTags(account, newsletterId),
				listImports(account, { newsletterId: selected._id, limit: 3 }),
			])
		: [{ contacts: [], counts: {}, totalAll: 0, total: 0 }, null, [], []];
	const pageCount = Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE));
	// totalAll counts within the search, the tag and the segment.
	const hasContacts =
		totalAll > 0 ||
		Boolean((query || tag || segment) && newsletterId && (await Contact.exists(scoped(account, { newsletterId: selected._id }))));
	const newsletter = selected && toNewsletterOption(selected);
	const filters = { status, query, segmentId, tag };

	function href(changes) {
		const next = new URLSearchParams(Object.entries({ segment: segmentId, tag, status, q: query, page }).filter(([, value]) => value));
		for (const [key, value] of Object.entries(changes)) {
			if (value) next.set(key, value);
			else next.delete(key);
		}
		if (next.get("page") === "1") next.delete("page");
		return `/contacts${next.size ? `?${next}` : ""}`;
	}

	// Deleting the last page's last contact leaves the page past the end.
	if (page > pageCount) redirect(href({ page: pageCount }));

	return (
		<ProviderContactOptions fields={fields} tags={tags}>
			<HeaderPage title="Contacts">
				<ButtonExportContacts newsletterId={newsletterId} {...filters} isDisabled={total === 0} />
				{hasContacts && <DialogContactFields />}
				{hasContacts && <DialogAddContact newsletter={newsletter} />}
				<GatePlan reason="import">
					<DialogImportContacts newsletter={newsletter} />
				</GatePlan>
			</HeaderPage>

			<div className="flex flex-col gap-4">
				{newsletterId && <CardImports key={newsletterId} newsletterId={newsletterId} imports={imports} />}
				{hasContacts && (
					<>
						<ListSegments
							newsletterId={newsletterId}
							segments={segments.map((item, index) => ({
								id: String(item._id),
								name: item.name,
								match: item.match,
								conditions: item.conditions,
								description: describeSegment(item, fields),
								contacts: cardCounts.segments[index],
							}))}
							selectedId={segmentId}
							everyoneCount={cardCounts.everyone}
							hrefFor={(id) => href({ segment: id, page: null })}
						/>

						<div className="flex gap-2">
							<Suspense fallback={<Skeleton className="h-9 w-full rounded-lg" />}>
								<FilterContacts key={newsletterId} tags={tags} />
							</Suspense>
							<MenuTagContacts newsletterId={newsletterId} filters={filters} count={total} />
						</div>

						<nav
							aria-label="Status"
							className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 animate-enter [scrollbar-width:none]"
						>
							{[null, ...CONTACT_STATUSES].map((key) => {
								const isActive = key === status;
								return (
									<Link
										key={key ?? "all"}
										href={href({ status: key, page: null })}
										scroll={false}
										aria-current={isActive ? "page" : undefined}
										className={cn(
											"inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm transition-[color,background-color] duration-150",
											isActive
												? "bg-muted font-medium text-foreground"
												: "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
										)}
									>
										{key ? key.charAt(0).toUpperCase() + key.slice(1) : "All"}
										<span className={cn("text-xs font-normal tabular-nums", isActive ? "text-muted-foreground" : "opacity-60")}>
											{formatNumber(key ? counts[key] || 0 : totalAll)}
										</span>
									</Link>
								);
							})}
						</nav>
					</>
				)}

				{!hasContacts ? (
					<CardAddContacts newsletter={newsletter} curl={getAddContactCurl(getAppUrl(), selected?.slug)} />
				) : contacts.length === 0 ? (
					<StateEmpty icon={Users} title="No contacts match" />
				) : (
					<div style={{ "--stagger": 1 }} className="overflow-hidden rounded-xl shadow-border animate-enter">
						<Table>
							<TableHeader>
								<TableRow className="hover:bg-transparent">
									<TableHead className="pl-4">Email</TableHead>
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
									<TableRow key={contact._id.toString()} className="tabular-nums">
										<TableCell className="w-full max-w-0 py-2.5 pl-4 font-medium sm:w-2/5">
											<span className="flex min-w-0 items-center gap-2.5">
												<AvatarContact
													email={contact.email}
													gravatarHash={gravatarHash(contact.email)}
													size={26}
												/>
												<span className="truncate">{contact.email}</span>
												{contact.firstName && (
													<span className="hidden max-w-40 truncate font-normal text-muted-foreground sm:inline">{contact.firstName}</span>
												)}
											</span>
										</TableCell>
										<TableCell className="hidden md:table-cell">
											<ListTags tags={contact.tags} />
										</TableCell>
										<TableCell>
											<BadgeStatus status={contact.status} label={contact.undeliverableAt && "Undeliverable"} />
										</TableCell>
										<TableCell className="hidden text-right lg:table-cell">
											{engagement(contact, "opens", "openRate")}
										</TableCell>
										<TableCell className="hidden text-right lg:table-cell">
											{engagement(contact, "clicks", "clickRate")}
										</TableCell>
										<TableCell className="hidden text-right text-muted-foreground sm:table-cell">
											{formatDate(contact.subscribedAt) ?? <TextEmpty />}
										</TableCell>
										<TableCell className="pr-2 text-right">
											<MenuContact
												id={contact._id.toString()}
												email={contact.email}
												status={contact.status}
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
				)}

				{pageCount > 1 && (
					<div className="flex items-center justify-between gap-3 text-sm text-muted-foreground tabular-nums">
						<span>
							{formatNumber((page - 1) * CONTACTS_PAGE_SIZE + 1)}–
							{formatNumber(Math.min(page * CONTACTS_PAGE_SIZE, total))} of{" "}
							{formatNumber(total)}
						</span>
						<div className="flex gap-1">
							<PageLink href={href({ page: page - 1 })} isDisabled={page <= 1} label="Previous">
								<ChevronLeft />
							</PageLink>
							<PageLink href={href({ page: page + 1 })} isDisabled={page >= pageCount} label="Next">
								<ChevronRight />
							</PageLink>
						</div>
					</div>
				)}
			</div>
		</ProviderContactOptions>
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

function gravatarHash(email) {
	return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

function engagement(contact, statKey, importedKey) {
	if (contact.stats?.[statKey]) return formatNumber(contact.stats[statKey]);
	const rate = contact.imported?.[importedKey];
	return rate === undefined || rate === null ? <TextEmpty /> : `${Math.round(rate * 100)}%`;
}
