import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import ButtonsContacts from "@/components/ButtonsContacts";
import CardAddContacts from "@/components/CardAddContacts";
import CardImports from "@/components/CardImports";
import FilterContacts from "@/components/FilterContacts";
import HeaderPage from "@/components/HeaderPage";
import ProviderContactOptions from "@/components/ProviderContactOptions";
import StateEmpty from "@/components/StateEmpty";
import TableContacts, { NavPages } from "@/components/TableContacts";
import { Skeleton } from "@/components/ui/skeleton";
import { scoped } from "@/lib/account-scope";
import { getAppUrl, isCloud } from "@/lib/config";
import { getFieldOptions } from "@/lib/contact-fields";
import { LIST_STATUSES, readContactFilters, toFilterQuery, toListQuery } from "@/lib/contact-filters";
import { CONTACTS_PAGE_SIZE, findContactsPage, listContactSources, listContactTags } from "@/lib/contacts";
import { getAddContactCurl } from "@/lib/docs/reference";
import { listImports } from "@/lib/import-jobs";
import { toNewsletterOption } from "@/lib/newsletters";
import { getSelectedNewsletter, openNewsletter } from "@/lib/selected-newsletter";
import { siteExtensions } from "@/lib/site-extensions";
import { isObjectIdString } from "@/lib/validation";
import Contact from "@/models/Contact";

export const metadata = { title: "Contacts" };

const NO_PAGE = { contacts: [], counts: {}, totalAll: 0, total: 0 };

// The open newsletter's contacts, with the search and the filters in the address (lib/contact-filters.js). A newsletter
// in ?newsletter=, from the filter this page had, opens first. ?segment=, the list's segment filter before segments had
// their pages, goes to the segment's page.
export default async function ContactsPage({ searchParams }) {
	const [view, params] = await Promise.all([getSelectedNewsletter(), searchParams]);
	openNewsletter(view, params.newsletter, "/contacts");
	const filters = readContactFilters(params, LIST_STATUSES);
	if (isObjectIdString(params.segment)) redirect(`/contacts/segments/${params.segment}${toFilterQuery(filters)}`);
	const { account, selected } = view;
	const newsletterId = selected ? String(selected._id) : null;
	const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
	const fields = getFieldOptions(account);

	const [{ contacts, counts, totalAll, total }, tags, sources, imports] = newsletterId
		? await Promise.all([
				findContactsPage(account, { newsletterId, page, ...toListQuery(filters) }),
				listContactTags(account, newsletterId),
				listContactSources(account, newsletterId),
				listImports(account, { newsletterId: selected._id, limit: 3 }),
			])
		: [NO_PAGE, [], [], []];
	const pageCount = Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE));
	// totalAll counts within the search and the filters but every status, while the card of an empty list and the export
	// follow the whole list, which a narrowed page that finds no one counts again.
	const isNarrowed = Boolean(filters.query || filters.tag || filters.source || filters.signedUpSince || filters.signedUpBefore);
	const listCount =
		isNarrowed && newsletterId && totalAll === 0
			? await Contact.countDocuments(scoped(account, { newsletterId: selected._id }), { limit: 1 })
			: totalAll;
	const hasContacts = listCount > 0;
	const newsletter = selected && toNewsletterOption(selected);
	const importGuides = isCloud() ? siteExtensions.importGuides : [];
	const curl = getAddContactCurl(getAppUrl(), selected?.slug);

	function hrefFor(target) {
		return `/contacts${toFilterQuery(filters, { page: target > 1 && target })}`;
	}

	// Deleting the last page's last contact leaves the page past the end.
	if (page > pageCount) redirect(hrefFor(pageCount));

	return (
		<ProviderContactOptions fields={fields} tags={tags}>
			<HeaderPage title="Contacts">
				<ButtonsContacts
					hasContacts={hasContacts}
					newsletter={newsletter}
					filters={filters}
					count={total}
					curl={curl}
					importGuides={importGuides}
				/>
			</HeaderPage>

			<div className="flex flex-col gap-4">
				{newsletterId && <CardImports key={newsletterId} newsletterId={newsletterId} imports={imports} />}
				{hasContacts && (
					<Suspense fallback={<Skeleton className="h-9 w-full rounded-lg" />}>
						<FilterContacts
							key={newsletterId}
							statuses={LIST_STATUSES.map((value) => ({ value, count: counts[value] ?? 0 }))}
							total={totalAll}
							tags={tags}
							sources={sources}
							count={total}
						/>
					</Suspense>
				)}

				{!hasContacts ? (
					<CardAddContacts newsletter={newsletter} curl={curl} importGuides={importGuides} />
				) : contacts.length === 0 ? (
					<StateEmpty icon={Users} title="No contacts match" />
				) : (
					<TableContacts contacts={contacts} fields={fields} />
				)}

				<NavPages page={page} pageCount={pageCount} total={total} hrefFor={hrefFor} />
			</div>
		</ProviderContactOptions>
	);
}