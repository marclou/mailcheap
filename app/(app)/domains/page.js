import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Check, ChevronDown, ChevronRight, Mail } from "lucide-react";
import ButtonCheckDomain from "@/components/ButtonCheckDomain";
import DialogRemoveDomain from "@/components/DialogRemoveDomain";
import FormAddDomain from "@/components/FormAddDomain";
import FormSwitchToDomain from "@/components/FormSwitchToDomain";
import GatePlan from "@/components/GatePlan";
import HeaderPage from "@/components/HeaderPage";
import ImageFavicon from "@/components/ImageFavicon";
import ListDnsSteps from "@/components/ListDnsSteps";
import TextStatus from "@/components/TextStatus";
import { Button } from "@/components/ui/button";
import { scoped } from "@/lib/account-scope";
import { hasActiveSubscription } from "@/lib/account-state";
import { getSharedDomain } from "@/lib/config";
import { getDomainSetup, getDomainSummary } from "@/lib/domain-records";
import { refreshDomains } from "@/lib/domains";
import { getEmailProvider } from "@/lib/email-provider";
import { getSenderPath } from "@/lib/newsletters";
import { rootDomain } from "@/lib/root-domain";
import {
	getEmailDomain,
	getOwnDomainLocalPart,
	getSharedAddress,
	isOnSharedDomain,
	isSharedSenderReady,
	withActiveProvider,
} from "@/lib/sender-rules";
import { requireRole } from "@/lib/selected-newsletter";
import { refreshSharedSender } from "@/lib/shared-sender";
import { OWNER_ROLE } from "@/lib/team-rules";
import { cn } from "@/lib/utils";
import Domain from "@/models/Domain";
import Newsletter from "@/models/Newsletter";

export const metadata = { title: "Domains" };

// The account's domains, which any of its newsletters can send from. "Check now" asks the email provider and DNS again.
export default async function DomainsPage() {
	const { account, selected } = await requireRole(OWNER_ROLE);
	const [stored, saved] = await Promise.all([
		Domain.find(scoped(account)).sort({ createdAt: 1 }).lean(),
		Newsletter.find(scoped(account)).sort({ createdAt: 1, _id: 1 }).select({ name: 1, slug: 1, fromEmail: 1, sharedSender: 1 }).lean(),
	]);
	const sharedDomain = getSharedDomain();
	const hasPlan = hasActiveSubscription(account);
	// A domain or a shared address still being set up is looked at again, at most once a minute. Without a plan
	// there's no shared address yet, and domains wait.
	const [refreshed, newsletters] = await Promise.all([
		hasPlan ? refreshDomains(account, stored) : stored,
		Promise.all(
			saved.map((newsletter) =>
				!hasPlan || isSharedSenderReady(newsletter, { sharedDomain }) ? newsletter : refreshSharedSender(account, newsletter)
			)
		),
	]);
	const domains = refreshed.map((domain) => withActiveProvider(domain));
	const isProviderSetUp = getEmailProvider().isConfigured();
	const verifiedDomain = domains.find(({ verified }) => verified) ?? null;
	const hasVerifiedDomain = Boolean(verifiedDomain);
	const sharedNewsletters = sharedDomain ? newsletters : [];
	// Until a domain is verified, a shared address row only says how it's doing, so nothing pulls away from adding one.
	// Then each newsletter still on the shared address gets a card with its sender settings instead.
	const stillShared =
		hasPlan && verifiedDomain ? sharedNewsletters.filter(({ fromEmail }) => isOnSharedDomain(fromEmail, sharedDomain)) : [];
	const sharedRows = sharedNewsletters.filter((newsletter) => !stillShared.includes(newsletter));
	const current = newsletters.find(({ _id }) => String(_id) === String(selected?._id)) ?? null;

	return (
		<>
			<HeaderPage title="Domains" />
			<div className="flex flex-col gap-6">
				<GatePlan reason="domain">
					<FormAddDomain fromLocalPart={getOwnDomainLocalPart(current?.fromEmail, sharedDomain)} />
				</GatePlan>
				{domains.map((domain, index) => (
					<CardDomain
						key={String(domain._id)}
						domain={domain}
						newsletters={hasPlan ? newsletters : []}
						current={hasPlan ? current : null}
						sharedDomain={sharedDomain}
						stagger={index + 1}
					/>
				))}
				{stillShared.map((newsletter, index) => (
					<CardSharedAddress
						key={String(newsletter._id)}
						newsletter={newsletter}
						domain={verifiedDomain}
						stagger={domains.length + 1 + index}
					/>
				))}
				{(hasVerifiedDomain || sharedRows.length > 0) && (
					<div className="-mt-2 flex flex-col">
						{hasVerifiedDomain && (
							<RowNote
								href="https://postmaster.google.com/v2/"
								icon={<Image src="/logos/postmaster-tools.webp" alt="" width={20} height={20} loading="lazy" unoptimized />}
								label="Postmaster Tools"
								detail="See how Gmail rates your domain"
								end={<ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />}
								stagger={domains.length + stillShared.length + 1}
							/>
						)}
						{sharedRows.map((newsletter, index) => (
							<RowNote
								key={String(newsletter._id)}
								icon={<Mail className="size-4 text-muted-foreground" />}
								label="Shared address"
								detail={<span className="font-mono text-xs">{getSharedAddress(newsletter.slug, sharedDomain)}</span>}
								end={<TextStatus {...getSharedStatus(newsletter, { sharedDomain, isProviderSetUp, hasPlan })} className="shrink-0 text-xs" />}
								stagger={domains.length + stillShared.length + 2 + index}
							/>
						))}
					</div>
				)}
			</div>
		</>
	);
}

function getSharedStatus(newsletter, { sharedDomain, isProviderSetUp, hasPlan }) {
	if (!isOnSharedDomain(newsletter.fromEmail, sharedDomain)) return { label: "Not in use", tone: "none" };
	if (!isProviderSetUp) return { label: "Email provider not set up", tone: "none" };
	if (!hasPlan) return { label: "Starts with a plan", tone: "none" };
	return isSharedSenderReady(newsletter, { sharedDomain }) ? { label: "Used until you switch", tone: "good" } : { label: "Setting up", tone: "wait" };
}

function CardSharedAddress({ newsletter, domain, stagger }) {
	return (
		<div
			style={{ "--stagger": stagger }}
			className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-border animate-enter sm:flex-row sm:items-center sm:gap-4"
		>
			<div className="flex min-w-0 flex-1 items-start gap-3">
				<span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground/75">
					<Mail className="size-[18px]" aria-hidden="true" />
				</span>
				<div className="min-w-0">
					<p className="text-sm font-medium text-balance">{newsletter.name} still sends from the shared address</p>
					<p className="text-sm text-pretty text-muted-foreground">
						<span className="whitespace-nowrap">
							<ImageFavicon domain={rootDomain(domain.domain)} size={16} className="mr-1 inline-block size-[1em] align-[-0.12em]" />
							{domain.domain}
						</span>{" "}
						is verified. Send from it instead.
					</p>
				</div>
			</div>
			<Button asChild variant="outline" size="sm" className="ml-12 self-start sm:ml-0 sm:self-center">
				<Link href={getSenderPath({ newsletterId: String(newsletter._id), domainId: String(domain._id) })}>Edit sender</Link>
			</Button>
		</div>
	);
}

function RowNote({ href, icon, label, detail, end, stagger }) {
	const Row = href ? "a" : "div";
	return (
		<Row
			{...(href && { href, target: "_blank", rel: "noreferrer" })}
			style={{ "--stagger": stagger }}
			className={cn(
				"flex min-h-11 items-center gap-3 rounded-xl px-4 py-2.5 text-sm animate-enter",
				href && "transition-colors duration-150 hover:bg-muted/60"
			)}
		>
			<span className="grid size-5 shrink-0 place-items-center">{icon}</span>
			<span className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
				<span className="block sm:w-32 sm:shrink-0">{label}</span>
				<span className="block truncate text-muted-foreground">{detail}</span>
			</span>
			{end}
		</Row>
	);
}

function CardDomain({ domain, newsletters, current, sharedDomain, stagger }) {
	const summary = getDomainSummary(domain);
	const setup = getDomainSetup(domain);
	const id = String(domain._id);
	// Once every record is found, they fold under one line, so sending from the domain is what the card is about.
	const isSetUp = domain.verified && setup.every(({ status }) => status.tone === "good");
	const records = <ListDnsSteps steps={setup} />;
	return (
		<section style={{ "--stagger": stagger }} className="overflow-hidden rounded-xl bg-card shadow-border animate-enter">
			<div className="flex flex-wrap items-center justify-between gap-3 p-4">
				<div className="flex min-w-0 items-center gap-3">
					<div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
						<ImageFavicon domain={rootDomain(domain.domain)} size={20} />
					</div>
					<div className="min-w-0">
						<p className="truncate font-medium">{domain.domain}</p>
						<TextStatus {...summary} className="text-xs" />
					</div>
				</div>
				<div className="flex items-center gap-1">
					<ButtonCheckDomain id={id} />
					<DialogRemoveDomain id={id} domain={domain.domain} />
				</div>
			</div>
			{current && <RowsSender domain={domain} newsletters={newsletters} current={current} sharedDomain={sharedDomain} />}
			{isSetUp ? (
				<details className="group/records disclosure">
					<summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-t border-border/60 px-4 py-3 text-sm text-muted-foreground outline-none transition-colors duration-150 select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
						DNS records
						<span className="flex items-center gap-3">
							<TextStatus label="All found" tone="good" className="text-xs" />
							<ChevronDown
								aria-hidden="true"
								className="size-4 transition-[rotate] duration-250 ease-drawer group-open/records:rotate-180 motion-reduce:transition-none"
							/>
						</span>
					</summary>
					{records}
				</details>
			) : (
				records
			)}
		</section>
	);
}

// The newsletters that send from the domain, then the open newsletter's switch to it.
function RowsSender({ domain, newsletters, current, sharedDomain }) {
	const senders = newsletters.filter(({ fromEmail }) => getEmailDomain(fromEmail) === domain.domain);
	const isCurrentSending = senders.some(({ _id }) => String(_id) === String(current._id));
	const until = domain.dnsProblems.length > 0 ? "its records are fixed" : "it's verified";

	return (
		<>
			{senders.map((newsletter) => (
				<p
					key={String(newsletter._id)}
					className="flex items-center gap-2 border-t border-border/60 bg-muted/40 px-4 py-3 text-sm text-pretty text-muted-foreground"
				>
					{domain.verified && <Check className="size-4 shrink-0 text-foreground" />}
					<span className="min-w-0">
						<span className="font-medium text-foreground">{newsletter.name}</span> sends from{" "}
						<span className="font-mono text-[13px] wrap-anywhere text-foreground">{newsletter.fromEmail}</span>
						{!domain.verified && ` once ${until}`}
					</span>
					<LinkSender href={getSenderPath({ newsletterId: String(newsletter._id) })} className="ml-auto">
						Sender
					</LinkSender>
				</p>
			))}
			{!isCurrentSending &&
				(domain.verified ? (
					<FormSwitchToDomain
						newsletterId={String(current._id)}
						newsletterName={current.name}
						domainId={String(domain._id)}
						domain={domain.domain}
						defaultLocalPart={getOwnDomainLocalPart(current.fromEmail, sharedDomain)}
					/>
				) : (
					<p className="border-t border-border/60 bg-muted/40 px-4 py-3 text-sm text-pretty text-muted-foreground">
						Once {until}, you can send <span className="font-medium text-foreground">{current.name}</span> from it here.
					</p>
				))}
		</>
	);
}

// A newsletter's sender settings, which open that newsletter first.
function LinkSender({ href, className, children }) {
	return (
		<Link
			href={href}
			className={cn(
				"group/sender relative flex shrink-0 items-center gap-0.5 rounded-md text-xs font-medium text-foreground outline-none transition-colors duration-150 after:absolute after:-inset-x-2 after:-inset-y-3 hover:text-foreground/80 focus-visible:ring-3 focus-visible:ring-ring/50",
				className
			)}
		>
			{children}
			<ChevronRight
				aria-hidden="true"
				className="size-3.5 text-muted-foreground transition-transform duration-150 ease-out group-hover/sender:translate-x-0.5"
			/>
		</Link>
	);
}
