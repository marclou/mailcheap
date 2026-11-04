import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { Users } from "lucide-react";
import ButtonsSegment from "@/components/ButtonsSegment";
import CardStat from "@/components/CardStat";
import FilterContacts from "@/components/FilterContacts";
import { TitlePage } from "@/components/HeaderPage";
import ProviderContactOptions from "@/components/ProviderContactOptions";
import ProviderContactSelection from "@/components/ProviderContactSelection";
import StateEmpty from "@/components/StateEmpty";
import TableContacts, { NavPages } from "@/components/TableContacts";
import { Skeleton } from "@/components/ui/skeleton";
import { scoped } from "@/lib/account-scope";
import { getFieldOptions } from "@/lib/contact-fields";
import { LIST_STATUSES, hasContactFilters, readContactFilters, toFilterQuery, toListQuery } from "@/lib/contact-filters";
import { CONTACTS_PAGE_SIZE, findContactsPage, listContactSources, listContactTags } from "@/lib/contacts";
import { formatDate, formatNumber, formatRate, formatRateChange } from "@/lib/format";
import { countActivity } from "@/lib/segment-queries";
import { ACTIVITY_DAYS, compileSegment, describeSegment } from "@/lib/segments";
import { findInNewsletters, getSelectedNewsletter, openNewsletter } from "@/lib/selected-newsletter";
import { isObjectIdString } from "@/lib/validation";
import Campaign from "@/models/Campaign";
import Segment from "@/models/Segment";

export const metadata = { title: "Segment" };

// One segment: who it picks and how they read next to the whole list, then its contacts with the list's search and
// filters. Its newsletter opens with it, like a contact's.
export default async function SegmentPage({ params, searchParams }) {
	const [{ id }, query, view] = await Promise.all([params, searchParams, getSelectedNewsletter()]);
	if (!isObjectIdString(id)) notFound();
	const { account } = view;
	const segment = await findInNewsletters(view, Segment, id);
	if (!segment || segment.deletedAt) notFound();
	openNewsletter(view, segment.newsletterId, `/contacts/segments/${id}`);
	if (!segment.newsletterId.equals(view.selected._id)) notFound();

	const newsletterId = String(segment.newsletterId);
	const filters = readContactFilters(query, LIST_STATUSES);
	const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
	const fields = getFieldOptions(account);
	const conditions = compileSegment(segment);
	const [{ contacts, counts, totalAll, total }, activity, list, tags, sources, campaigns] = await Promise.all([
		findContactsPage(account, { newsletterId, page, segmentFilter: { $and: [conditions] }, ...toListQuery(filters) }),
		countActivity(account, newsletterId, conditions),
		countActivity(account, newsletterId, null),
		listContactTags(account, newsletterId),
		listContactSources(account, newsletterId),
		Campaign.find(scoped(account, { segmentId: segment._id, status: "sent" }))
			.sort({ sentAt: -1 })
			.select({ sentAt: 1 })
			.lean(),
	]);
	const pageCount = Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE));
	const rules = { id, name: segment.name, match: segment.match ?? "all", conditions: segment.conditions ?? [], contacts: activity.contacts };
	const isFiltered = hasContactFilters(filters);

	function hrefFor(target) {
		return `/contacts/segments/${id}${toFilterQuery(filters, { page: target > 1 && target })}`;
	}

	if (page > pageCount) redirect(hrefFor(pageCount));

	return (
		<ProviderContactOptions fields={fields} tags={tags}>
			<header className="mb-8 flex flex-col gap-1 animate-enter">
				<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
					<TitlePage title={segment.name} parent={{ label: "Segments", href: "/contacts/segments" }} />
					<div className="flex items-center gap-2">
						<ButtonsSegment newsletterId={newsletterId} segment={rules} filters={filters} count={total} />
					</div>
				</div>
				<p className="text-sm text-pretty text-muted-foreground sm:pl-9">{describeSegment(segment, fields)}</p>
			</header>

			<div className="flex flex-col gap-6">
				<div style={{ "--stagger": 1 }} className="grid grid-cols-2 gap-3 animate-enter lg:grid-cols-4">
					<CardStat
						label="Active contacts"
						value={formatNumber(activity.contacts)}
						detail={list.contacts > 0 ? `${formatRate(activity.contacts, list.contacts, 0)} of your list` : "No one on your list yet"}
					/>
					<CardStat label="Opened" {...getRateCard(activity, list, "opened")} />
					<CardStat label="Clicked" {...getRateCard(activity, list, "clicked")} />
					<CardStat
						label="Campaigns"
						value={formatNumber(campaigns.length)}
						detail={campaigns.length > 0 ? `Last sent ${formatDate(campaigns[0].sentAt)}` : "None sent to it yet"}
					/>
				</div>

				<div className="flex flex-col gap-4">
					{totalAll > 0 || isFiltered ? (
						<Suspense fallback={<Skeleton className="h-9 w-full rounded-lg" />}>
							<FilterContacts
								key={id}
								statuses={LIST_STATUSES.map((value) => ({ value, count: counts[value] ?? 0 }))}
								total={totalAll}
								tags={tags}
								sources={sources}
								count={total}
							/>
						</Suspense>
					) : null}

					{contacts.length === 0 ? (
						<StateEmpty icon={Users} title={totalAll > 0 || isFiltered ? "No contacts match" : "No one is in this segment yet"} />
					) : (
						<ProviderContactSelection
							key={`${id}${toFilterQuery(filters, { page })}`}
							newsletterId={newsletterId}
							filters={{ ...filters, segmentId: id }}
							total={total}
							counts={counts}
							contacts={contacts.map(({ _id, status, tags: contactTags }) => ({ id: String(_id), status, tags: contactTags ?? [] }))}
						>
							<TableContacts contacts={contacts} fields={fields} />
							<NavPages page={page} pageCount={pageCount} total={total} hrefFor={hrefFor} />
						</ProviderContactSelection>
					)}
				</div>
			</div>
		</ProviderContactOptions>
	);
}
// The share of the segment's active contacts who opened or clicked lately, next to the whole list's.
function getRateCard(activity, list, key) {
	if (activity.contacts === 0) return { value: null, detail: `In the last ${ACTIVITY_DAYS} days` };
	const rate = activity[key] / activity.contacts;
	const listRate = list.contacts > 0 ? list[key] / list.contacts : null;
	const isWholeList = activity.contacts === list.contacts;
	const delta = listRate === null || isWholeList ? null : rate - listRate;
	return {
		value: formatRate(activity[key], activity.contacts, 0),
		detail: `In the last ${ACTIVITY_DAYS} days`,
		...(delta !== null && {
			change: { text: formatRateChange(delta), note: "vs your list", title: `Your list: ${formatRate(list[key], list.contacts, 1)}`, isUp: delta > 0 },
		}),
	};
}
