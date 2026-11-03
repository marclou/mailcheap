import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
	Ban,
	ChevronLeft,
	ChevronRight,
	History,
	MailCheck,
	MailX,
	Moon,
	ShieldAlert,
	Tags as TagsIcon,
	UserCheck,
	UserPlus,
	UserRound,
	UserX,
} from "lucide-react";
import AvatarContact from "@/components/AvatarContact";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import BadgeStatus from "@/components/BadgeStatus";
import ButtonAddField from "@/components/ButtonAddField";
import ButtonCopy from "@/components/ButtonCopy";
import ButtonEditContact from "@/components/ButtonEditContact";
import ButtonEditTags from "@/components/ButtonEditTags";
import ButtonMergeTag from "@/components/ButtonMergeTag";
import CardLocation from "@/components/CardLocation";
import CardSettings from "@/components/CardSettings";
import CardStat from "@/components/CardStat";
import { EMAIL_OUTCOME_LOOKS, ICON_TONES } from "@/components/IconEmailOutcome";
import ImageFavicon from "@/components/ImageFavicon";
import LinkHelpFields from "@/components/LinkHelpFields";
import LinkHelpTags from "@/components/LinkHelpTags";
import MenuContactMore from "@/components/MenuContactMore";
import MenuContactStatus from "@/components/MenuContactStatus";
import ProviderContactOptions from "@/components/ProviderContactOptions";
import TabsPage, { PanelTab } from "@/components/TabsPage";
import TextEmpty from "@/components/TextEmpty";
import { Button } from "@/components/ui/button";
import { scoped } from "@/lib/account-scope";
import { countContactEmails, listContactEmails } from "@/lib/contact-emails";
import { MAX_CONTACT_FIELDS, contactFieldValues } from "@/lib/contact-fields";
import { getContactHistory } from "@/lib/contact-history";
import { UNDELIVERABLE_LABELS } from "@/lib/contact-status";
import { listContactTags } from "@/lib/contacts";
import { formatDate, formatDateTime, formatNumber, formatRate, formatRelative } from "@/lib/format";
import { gravatarHash } from "@/lib/gravatar";
import { formatLinkUrl } from "@/lib/link-stats";
import { fieldTag, fillSubject, firstNameTag } from "@/lib/merge-tags";
import { PROVIDER_DOMAINS, PROVIDER_LABELS, mailboxProvider } from "@/lib/providers";
import { rootDomain } from "@/lib/root-domain";
import { findContactSegments, listLiveSegments } from "@/lib/segment-queries";
import { findInNewsletters, getSelectedNewsletter, openNewsletter } from "@/lib/selected-newsletter";
import { TIME_ZONE_COOKIE, resolveTimeZone } from "@/lib/time-zone";
import { cn } from "@/lib/utils";
import { isObjectIdString } from "@/lib/validation";
import Contact from "@/models/Contact";
import ContactImport from "@/models/ContactImport";

export const metadata = { title: "Contact" };

// The emails the timeline shows at first, and how many more each Show older emails adds (?emails=).
const EMAILS_STEP = 30;
const MAX_EMAILS = 600;

// One contact: who they are, where and how they read, then in tabs every email they got and what they did with it among
// the rest of their history, where they came from with their segments and other newsletters, and their fields and tags.
// Its newsletter opens with it, like a campaign's.
export default async function ContactPage({ params, searchParams }) {
	const [{ id }, query, view, cookieStore] = await Promise.all([params, searchParams, getSelectedNewsletter(), cookies()]);
	if (!isObjectIdString(id)) notFound();
	const { account, newsletters } = view;
	const contact = await findInNewsletters(view, Contact, id);
	if (!contact) notFound();
	openNewsletter(view, contact.newsletterId, `/contacts/${id}`);
	if (!contact.newsletterId.equals(view.selected._id)) notFound();

	const timeZone = resolveTimeZone(cookieStore.get(TIME_ZONE_COOKIE)?.value);
	const limit = Math.min(MAX_EMAILS, Math.max(EMAILS_STEP, Number.parseInt(query.emails, 10) || EMAILS_STEP));
	const fields = (account.contactFields ?? []).map(({ key, label, type }) => ({ key, label, type }));
	const [{ emails, nextCursor }, counts, tags, segments, others, contactImport] = await Promise.all([
		listContactEmails(account, contact, { limit }),
		countContactEmails(account, contact),
		listContactTags(account, contact.newsletterId),
		readSegments(account, contact),
		Contact.find(scoped(account, { email: contact.email, _id: { $ne: contact._id } }))
			.select({ newsletterId: 1, status: 1 })
			.lean(),
		contact.importId ? ContactImport.findOne(scoped(account, { _id: contact.importId })).select({ fileName: 1 }).lean() : null,
	]);

	const name = contact.firstName || null;
	const inbox = getInbox(contact.email);
	const values = contactFieldValues(contact, fields);
	const details = { id, email: contact.email, firstName: contact.firstName ?? "", tags: contact.tags ?? [], fields: values };
	const byNewsletter = new Map(newsletters.map((newsletter) => [String(newsletter._id), newsletter]));
	const otherNewsletters = others.filter(({ newsletterId }) => byNewsletter.has(String(newsletterId)));
	const source = { ...contact, fileName: contactImport?.fileName ?? null };
	const timeline = getTimeline({ emails, hasMore: Boolean(nextCursor), history: getContactHistory(contact) });

	return (
		<ProviderContactOptions fields={fields} tags={tags}>
			<header className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-4 animate-enter">
				<div className="flex min-w-0 flex-1 items-center gap-2 sm:mr-auto sm:flex-initial sm:pr-4">
					<Link
						href="/contacts"
						aria-label="Back"
						className="-ml-2 grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
					>
						<ChevronLeft className="size-5" />
					</Link>
					<AvatarContact email={contact.email} gravatarHash={gravatarHash(contact.email)} size={56} />
					<div className="ml-2 flex min-w-0 flex-col gap-0.5">
						<div className="flex min-w-0 items-center gap-1">
							<h1 className="truncate text-2xl font-semibold tracking-tight">{name ?? contact.email}</h1>
							{!name && <ButtonCopy value={contact.email} label="Copy email address" />}
						</div>
						{name && (
							<p className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
								<span className="truncate">{contact.email}</span>
								<ButtonCopy value={contact.email} label="Copy email address" />
							</p>
						)}
					</div>
				</div>
				<div className="flex basis-full max-sm:order-2 sm:basis-auto">
					<MenuContactStatus
						id={id}
						email={contact.email}
						status={contact.status}
						label={contact.undeliverableAt && (UNDELIVERABLE_LABELS[contact.undeliverableReason] ?? "Undeliverable")}
						undeliverableReason={contact.undeliverableReason}
					/>
				</div>
				{/* On a phone, next to the name, above their status. */}
				<MenuContactMore contact={details} status={contact.status} className="max-sm:order-1" />
			</header>

			<div className="flex flex-col gap-6">
				<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
					<CardLocation country={contact.country} source={contact.source} stagger={1} />
					<div style={{ "--stagger": 2 }} className="grid grid-cols-2 gap-3 animate-enter md:grid-cols-4 lg:grid-cols-2">
						<CardStat
							label="Emails received"
							value={formatNumber(counts.sent)}
							detail={contact.lastSentAt ? `Last on ${formatDate(contact.lastSentAt, timeZone)}` : "None yet"}
						/>
						<CardStat label="Opened" {...getRateCard(counts.opened, counts.sent, contact.imported?.openRate)} />
						<CardStat label="Clicked" {...getRateCard(counts.clicked, counts.sent, contact.imported?.clickRate)} />
						<CardStat
							label="Last opened"
							value={formatRelative(contact.lastOpenAt)}
							detail={formatDate(contact.lastOpenAt, timeZone) ?? "Never"}
						/>
					</div>
				</div>

				<TabsPage tabs={CONTACT_TABS} style={{ "--stagger": 3 }}>
					<PanelTab value="activity">
						<section aria-label="Activity" className="rounded-xl bg-card shadow-border">
							<ol className="flex flex-col p-4">
								{timeline.map((item) =>
									item.email ? (
										<ItemEmail
											key={item.key}
											email={item.email}
											contact={contact}
											contactFields={account.contactFields}
											timeZone={timeZone}
										/>
									) : (
										<ItemEvent key={item.key} event={item.event} source={source} timeZone={timeZone} />
									)
								)}
							</ol>
							{nextCursor && (
								<div className="border-t border-border/60 p-2">
									<Button asChild variant="ghost" className="w-full text-muted-foreground">
										<Link href={`/contacts/${id}?emails=${limit + EMAILS_STEP}`} scroll={false}>
											Show older emails
										</Link>
									</Button>
								</div>
							)}
						</section>
					</PanelTab>

					<PanelTab value="about" className="flex flex-col gap-4">
						<section aria-label="About" className="rounded-xl bg-card p-4 shadow-border sm:p-5">
							<dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
								<Property label="Subscribed">{formatDate(contact.subscribedAt, timeZone)}</Property>
								<Property label="Source">
									<TextSource contact={source} />
								</Property>
								<Property label="Email provider">
									<span className="flex min-w-0 items-center gap-1.5">
										<ImageFavicon domain={inbox.domain} size={14} />
										<span className="truncate">{inbox.label}</span>
									</span>
								</Property>
								{contact.confirmedAt && <Property label="Confirmed">{formatDate(contact.confirmedAt, timeZone)}</Property>}
								<Property label="Last click">{formatDate(contact.lastClickAt, timeZone) ?? <TextEmpty label="Never" />}</Property>
								{hasImportedNumbers(contact.imported) && <Property label="Before MailCheap">{describeImported(contact.imported)}</Property>}
							</dl>
						</section>

						{(segments.hasAny || otherNewsletters.length > 0) && (
							<div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
								{segments.hasAny && (
									<CardSettings title="Segments">
										{segments.matched.length > 0 ? (
											segments.matched.map((segment) => (
												<RowLink key={String(segment._id)} href={`/contacts/segments/${segment._id}`}>
													<span className="truncate">{segment.name}</span>
												</RowLink>
											))
										) : (
											<p className="px-4 py-3 text-sm text-muted-foreground">In none of your segments</p>
										)}
									</CardSettings>
								)}
								{otherNewsletters.length > 0 && (
									<CardSettings title="Other newsletters">
										{otherNewsletters.map((other) => {
											const newsletter = byNewsletter.get(String(other.newsletterId));
											return (
												<RowLink key={String(other._id)} href={`/contacts/${other._id}`}>
													<span className="flex min-w-0 items-center gap-2">
														<AvatarNewsletter newsletter={newsletter} size={18} />
														<span className="truncate">{newsletter.name}</span>
													</span>
													<BadgeStatus status={other.status} className="ml-auto" />
												</RowLink>
											);
										})}
									</CardSettings>
								)}
							</div>
						)}
					</PanelTab>

					<PanelTab value="fields" className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
						<CardSettings
							title="Fields"
							action={
								<ButtonEditContact contact={details} variant="ghost" size="sm">
									Edit
								</ButtonEditContact>
							}
						>
							<dl className="grid grid-cols-1 gap-x-6 gap-y-5 p-4 sm:grid-cols-2">
								<PropertyField label="First name" tag={firstNameTag("")}>
									{name ?? <TextEmpty />}
								</PropertyField>
								{fields.map((field) => (
									<PropertyField key={field.key} label={field.label} tag={fieldTag(field.key)}>
										<TextFieldValue field={field} value={values[field.key]} />
									</PropertyField>
								))}
							</dl>
							<div className="flex flex-col items-start gap-2.5 px-4 py-3">
								<p className="text-xs text-pretty text-muted-foreground">
									Type a field between double braces in an email, like {firstNameTag("")}, to print each reader&apos;s value.
									Fields you add, like a company, are on every contact.
								</p>
								<div className="-ml-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
									{fields.length < MAX_CONTACT_FIELDS && <ButtonAddField />}
									<LinkHelpFields className="ml-2.5" />
								</div>
							</div>
						</CardSettings>

						<CardSettings
							title="Tags"
							action={
								<ButtonEditTags contact={details} variant="ghost" size="sm">
									Edit
								</ButtonEditTags>
							}
						>
							<div className="p-4">
								{details.tags.length > 0 ? (
									<span className="flex flex-wrap gap-1.5">
										{details.tags.map((tag) => (
											<Link
												key={tag}
												href={`/contacts?tag=${encodeURIComponent(tag)}`}
												className="inline-flex h-6 max-w-full items-center rounded-md bg-muted px-2 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
											>
												<span className="truncate">{tag}</span>
											</Link>
										))}
									</span>
								) : (
									<p className="text-sm text-muted-foreground">No tags yet</p>
								)}
							</div>
							<div className="flex flex-col items-start gap-2.5 px-4 py-3">
								<p className="text-xs text-pretty text-muted-foreground">
									Tags sort contacts for your list and segments. They never show in emails.
								</p>
								<LinkHelpTags />
							</div>
						</CardSettings>
					</PanelTab>
				</TabsPage>
			</div>
		</ProviderContactOptions>
	);
}

function Property({ label, children }) {
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="flex min-h-5 min-w-0 items-center text-sm break-words">{children}</dd>
		</div>
	);
}

// A field's name and the contact's value, over the tag that prints it in emails.
function PropertyField({ label, tag, children }) {
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="flex min-w-0 flex-col items-start gap-2 text-sm">
				<span className="flex min-h-5 max-w-full min-w-0 items-center break-words">{children}</span>
				<ButtonMergeTag tag={tag} className="max-w-full -translate-x-px" />
			</dd>
		</div>
	);
}

// A value as the contact's page shows it: a link with its site's icon for a web address.
function TextFieldValue({ field, value }) {
	const text = formatFieldValue(field, value);
	if (text === null) return <TextEmpty />;
	const host = field.type === "text" && /^https?:\/\//i.test(text) ? hostOf(text) : null;
	if (!host) return text;
	return (
		<a
			href={text}
			target="_blank"
			rel="noopener noreferrer"
			title={text}
			className="flex min-w-0 items-center gap-1.5 underline decoration-foreground/20 underline-offset-4 transition-colors duration-150 hover:decoration-foreground/60"
		>
			<ImageFavicon domain={host} size={14} />
			<span className="truncate">{formatLinkUrl(text)}</span>
		</a>
	);
}

function RowLink({ href, children }) {
	return (
		<Link
			href={href}
			className="flex items-center gap-2 px-4 py-2.5 text-sm transition-colors duration-150 hover:bg-muted/40"
		>
			<span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
			<ChevronRight className="size-4 shrink-0 text-muted-foreground" />
		</Link>
	);
}

// One step of the timeline: its icon on the line, what happened, when, and anything under it. before: for a step whose
// date wasn't recorded, the date of the step that revealed it.
function ItemTimeline({ icon: Icon, tone = "muted", title, at, before = null, timeZone, children }) {
	return (
		<li className="group relative flex gap-3 pb-5 last:pb-0">
			<span aria-hidden="true" className="absolute top-8 bottom-0 left-3.5 w-px -translate-x-1/2 bg-border group-last:hidden" />
			<span className={cn("grid size-7 shrink-0 place-items-center rounded-full", ICON_TONES[tone])}>
				<Icon className="size-3.5" />
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1">
				<div className="flex items-baseline justify-between gap-3">
					<p className="min-w-0 text-sm text-pretty">{title}</p>
					{before ? (
						<span title="Its date wasn't recorded" className="shrink-0 text-xs text-muted-foreground tabular-nums">
							Before {formatDay(before, timeZone)}
						</span>
					) : (
						<time
							dateTime={new Date(at).toISOString()}
							title={formatDateTime(at, timeZone)}
							className="shrink-0 text-xs text-muted-foreground tabular-nums"
						>
							{formatDay(at, timeZone)}
						</time>
					)}
				</div>
				{children}
			</div>
		</li>
	);
}

// An email, by what it came to: the furthest of delivered, opened and clicked, or what stopped it. Its subject shows as
// they got it, with their first name and field values.
function ItemEmail({ email, contact, contactFields, timeZone }) {
	const { outcome } = email;
	const { verb, icon, tone } = EMAIL_OUTCOME_LOOKS[outcome];
	const links = email.clickedLinks.filter((url) => /^https?:\/\//i.test(url));
	const moments = [
		email.openedAt && `Opened ${formatMoment(email.openedAt, timeZone)}`,
		email.clickedAt && `Clicked ${formatMoment(email.clickedAt, timeZone)}`,
	].filter(Boolean);
	const note = OUTCOME_NOTES[outcome] ?? (outcome === "unsent" ? UNSENT_REASONS[email.status] : moments.join(" · "));

	return (
		<ItemTimeline
			icon={icon}
			tone={tone}
			at={email.sentAt ?? email.createdAt}
			timeZone={timeZone}
			title={
				<>
					<span className="text-muted-foreground">{verb}</span>{" "}
					{email.campaign ? (
						<Link
							href={`/campaigns/${email.campaign.id}`}
							className="font-medium underline decoration-foreground/0 underline-offset-4 transition-colors duration-150 hover:decoration-foreground/40"
						>
							{fillSubject(email.campaign.subject || "Untitled", { firstName: contact.firstName, values: contact.fields, contactFields })}
						</Link>
					) : (
						<span className="font-medium">{KIND_LABELS[email.kind] ?? "An email"}</span>
					)}
				</>
			}
		>
			{note && <p className="text-xs text-muted-foreground tabular-nums">{note}</p>}
			{links.length > 0 && (
				<ul className="flex flex-col gap-1">
					{links.map((url) => (
						<li key={url} className="min-w-0">
							<a
								href={url}
								target="_blank"
								rel="noopener noreferrer"
								className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
							>
								<ImageFavicon domain={hostOf(url)} size={14} />
								<span className="truncate">{formatLinkUrl(url)}</span>
							</a>
						</li>
					))}
				</ul>
			)}
		</ItemTimeline>
	);
}

// Joining, or a change of status, whatever made it (lib/contact-history.js).
function ItemEvent({ event, source, timeZone }) {
	const { icon, tone, title, note } = describeEvent(event, source);
	return (
		<ItemTimeline icon={icon} tone={tone} title={title} at={event.at} before={event.before} timeZone={timeZone}>
			{note && <p className="text-xs text-muted-foreground">{note}</p>}
		</ItemTimeline>
	);
}

// Where the contact came from, with the site of the form they used.
function TextSource({ contact }) {
	if (contact.source === "embed" && contact.sourceDomain) {
		return (
			<span className="flex min-w-0 items-center gap-1.5">
				<ImageFavicon domain={contact.sourceDomain} size={14} />
				<span className="truncate">{contact.sourceDomain}</span>
			</span>
		);
	}
	if (contact.source === "import" && contact.fileName) return <span className="truncate">Import · {contact.fileName}</span>;
	return SOURCE_LABELS[contact.source] ?? (contact.source ? `API · ${contact.source}` : <TextEmpty />);
}

async function readSegments(account, contact) {
	const segments = await listLiveSegments(account, contact.newsletterId);
	return { hasAny: segments.length > 0, matched: await findContactSegments(account, contact, segments) };
}

// Their emails and the rest of their history, newest first. While older emails are left out, so is what came before the
// oldest one shown.
function getTimeline({ emails, hasMore, history }) {
	const oldest = hasMore ? new Date(emails.at(-1).sentAt ?? emails.at(-1).createdAt).getTime() : -Infinity;
	return [
		...emails.map((email) => ({ key: email.id, at: email.sentAt ?? email.createdAt, email })),
		...history
			.filter(({ at }) => new Date(at).getTime() >= oldest)
			.map((event, index) => ({ key: `${event.type}-${index}`, at: event.at, event })),
	].toSorted((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function describeEvent(event, contact) {
	if (event.type === "added") return { icon: UserPlus, tone: "green", title: describeJoin(contact) };
	if (event.type === "signed-up-again") return { icon: UserPlus, tone: "green", title: "Signed up again" };
	if (event.type === "confirmed") return { icon: MailCheck, tone: "green", title: "Confirmed their subscription" };
	if (event.type === "unsubscribed") return { icon: UserX, tone: "red", title: "Unsubscribed" };
	if (event.type === "stopped") return { icon: Ban, tone: "red", title: STOP_TITLES[event.reason] ?? STOP_TITLES.default };
	return describeStatusChange(event);
}

// A change of status, by what made it (lib/status-changes.js). One without a cause went unrecorded.
function describeStatusChange({ from, to, via, source, reason, consent }) {
	const look = CHANGE_LOOKS[to] ?? CHANGE_LOOKS.active;
	if (!via) return { ...look, title: UNRECORDED_TITLES[to] ?? look.title };
	const cause = CAUSES[via]?.({ to, source, reason });
	if (cause) return { ...look, ...cause };
	const title = from === "unsubscribed" && to === "active" ? "Resubscribed" : look.title;
	return { ...look, title: [title, ACTORS[via]].filter(Boolean).join(" "), note: consent ? "They asked for it" : null };
}

function describeJoin(contact) {
	if (contact.source === "embed") {
		return contact.sourceDomain ? (
			<>
				Signed up with the form on{" "}
				<span className="inline-flex items-center gap-1 align-bottom font-medium">
					<ImageFavicon domain={contact.sourceDomain} size={14} />
					{contact.sourceDomain}
				</span>
			</>
		) : (
			"Signed up with the form on your site"
		);
	}
	if (contact.source === "import") {
		return contact.fileName ? (
			<>
				Imported from <span className="font-medium break-all">{contact.fileName}</span>
			</>
		) : (
			"Imported"
		);
	}
	return JOIN_TITLES[contact.source] ?? (contact.source ? `Added through the API (${contact.source})` : "Added");
}

function hostOf(url) {
	try {
		return new URL(url).hostname;
	} catch {
		return null;
	}
}

function getInbox(email) {
	const provider = mailboxProvider(email);
	if (provider !== "other") return { domain: PROVIDER_DOMAINS[provider], label: PROVIDER_LABELS[provider] };
	const domain = rootDomain(email);
	return { domain, label: domain };
}

// A rate of the emails MailCheap sent them, else the one an import brought from their previous platform.
function getRateCard(part, sent, importedRate) {
	if (sent > 0) return { value: formatRate(part, sent, 0), detail: `${formatNumber(part)} of ${formatNumber(sent)}` };
	if (Number.isFinite(importedRate)) return { value: `${Math.round(importedRate * 100)}%`, detail: "Before MailCheap" };
	return { value: null, detail: "No emails yet" };
}

function hasImportedNumbers(imported) {
	return ["emailsReceived", "openRate", "clickRate"].some((key) => Number.isFinite(imported?.[key]));
}

// "40 emails, 62% opened, 8% clicked"
function describeImported({ emailsReceived, openRate, clickRate }) {
	return [
		Number.isFinite(emailsReceived) && `${formatNumber(emailsReceived)} ${emailsReceived === 1 ? "email" : "emails"}`,
		Number.isFinite(openRate) && `${Math.round(openRate * 100)}% opened`,
		Number.isFinite(clickRate) && `${Math.round(clickRate * 100)}% clicked`,
	]
		.filter(Boolean)
		.join(", ");
}

// Dates are days, kept at midnight UTC (lib/contact-fields.js).
function formatFieldValue(field, value) {
	if (value === undefined || value === null) return null;
	if (field.type === "date") return formatDate(`${value}T00:00:00Z`, "UTC");
	if (field.type === "number") return formatNumber(value);
	return value;
}

// "Oct 7", with the year when it isn't this one.
function formatDay(value, timeZone) {
	const yearOf = (date) => date.toLocaleDateString("en-US", { year: "numeric", timeZone });
	const date = new Date(value);
	const isThisYear = yearOf(date) === yearOf(new Date());
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(!isThisYear && { year: "numeric" }), timeZone });
}

// "Oct 7, 4:12 PM"
function formatMoment(value, timeZone) {
	return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });
}

const CONTACT_TABS = [
	{ value: "activity", icon: History, label: "Activity" },
	{ value: "about", icon: UserRound, label: "About" },
	{ value: "fields", icon: TagsIcon, label: "Fields and tags" },
];

const OUTCOME_NOTES = { waiting: "Waiting to go out", undelivered: "It never reached their inbox" };

const UNSENT_REASONS = {
	failed: "It couldn't be sent",
	suppressed: "Their address is on your do-not-email list",
	skipped: "This month's emails were used up",
};

const KIND_LABELS = { welcome: "Welcome email", confirmation: "Confirmation email", "last-chance": "Last-chance email" };

const JOIN_TITLES = {
	website: "Signed up on your website",
	dashboard: "Added by hand",
	api: "Added through the API",
};

const SOURCE_LABELS = {
	website: "Your website",
	embed: "Form on your site",
	import: "Import",
	dashboard: "Added by hand",
	api: "API",
};

// Each status's icon, and its title for a change someone made.
const CHANGE_LOOKS = {
	active: { title: "Marked active", icon: UserCheck, tone: "green" },
	pending: { title: "Waiting to confirm", icon: UserPlus, tone: "green" },
	dormant: { title: "Marked dormant", icon: Moon, tone: "amber" },
	unsubscribed: { title: "Unsubscribed", icon: UserX, tone: "red" },
	bounced: { title: "Bounced", icon: Ban, tone: "red" },
	complained: { title: "Marked an email as spam", icon: ShieldAlert, tone: "red" },
};

const ACTORS = { dashboard: "by you", api: "through the API", mcp: "by an AI assistant" };

const STOP_TITLES = {
	"no-mail-server": "Stopped: their domain can't receive email",
	"spam-domain": "Stopped: their domain is a known spam domain",
	default: "Stopped: their address can't receive email",
};

const BACK_TITLES = {
	"no-mail-server": "Back: their domain can receive email again",
	"spam-domain": "Back: their domain is off the spam list",
	admin: "Back: their address can receive email after all",
	default: "Back: their domain is fine again",
};

const SIGNUP_PLACES = { website: " on your website", embed: " with the form on your site" };

// The changes nobody made by hand, by what made them.
const CAUSES = {
	signup: ({ to, source }) => ({
		icon: UserPlus,
		tone: "green",
		title: `Signed up again${SIGNUP_PLACES[source] ?? (source ? " through the API" : "")}`,
		note: to === "pending" ? "Waiting for them to confirm" : null,
	}),
	confirmation: () => ({ icon: MailCheck, title: "Confirmed their subscription" }),
	keep: () => ({ title: "Asked to keep getting your emails", note: "In the last-chance email" }),
	cleanup: () => ({ title: "Went dormant", note: "No answer to the last-chance email" }),
	link: () => ({ title: "Unsubscribed", note: "With the link in your email" }),
	"mail-app": () => ({ title: "Unsubscribed", note: "With their mail app's unsubscribe button" }),
	provider: () => ({ title: "Unsubscribed", note: "Through their email provider" }),
	bounce: () => ({ icon: MailX, title: "Stopped: their address bounced" }),
	complaint: () => ({ title: "Stopped: they marked an email as spam" }),
	undeliverable: () => ({ title: STOP_TITLES.default }),
	hygiene: ({ to, reason }) => ({
		title: to === "bounced" ? (STOP_TITLES[reason] ?? STOP_TITLES.default) : (BACK_TITLES[reason] ?? BACK_TITLES.default),
	}),
	admin: () => ({ title: BACK_TITLES.admin }),
	import: () => ({ note: "From an import" }),
};

// A change only a later one revealed, when nothing recorded what made it.
const UNRECORDED_TITLES = {
	active: "Back to active",
	pending: "Signed up again",
	dormant: "Went dormant",
	unsubscribed: "Unsubscribed",
	bounced: "Bounced",
	complained: "Marked an email as spam",
};
