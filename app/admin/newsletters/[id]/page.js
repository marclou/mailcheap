import Link from "next/link";
import { notFound } from "next/navigation";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import BadgeStatus from "@/components/BadgeStatus";
import CardContentReview from "@/components/CardContentReview";
import HeaderPage from "@/components/HeaderPage";
import { describeBlocker, getAccountStatus, isBlocked } from "@/lib/account-state";
import { getNewsletterForAdmin } from "@/lib/admin-stats";
import { requireAdmin } from "@/lib/auth";
import { CONFIRM_URL_PLACEHOLDER, KEEP_URL_PLACEHOLDER } from "@/lib/action-links";
import { toPreviewHtml } from "@/lib/email-preview";
import { formatRelative } from "@/lib/format";
import { getPostalAddress } from "@/lib/postal-address";
import { renderEmail } from "@/lib/render-email";
import { serialize } from "@/lib/serialize";
import { SIGNUP_EMAIL_KINDS, getCurrentReview, getOwnSignupEmail } from "@/lib/signup-email-review";
import { siteExtensions } from "@/lib/site-extensions";
import { isObjectIdString } from "@/lib/validation";

export const metadata = { title: "Newsletter" };

// Any account's newsletter, read-only: its own welcome, confirmation and last-chance emails as readers get them, what the
// content check found in each, and the decision on one it holds. The layout lets only ADMIN_EMAILS in; this page checks
// again, and everyone else gets the same 404 as a missing newsletter.
export default async function AdminNewsletterPage({ params }) {
	await requireAdmin();
	const { id } = await params;
	if (!isObjectIdString(id)) notFound();
	const found = await getNewsletterForAdmin(id);
	if (!found) notFound();

	const newsletter = { ...found.newsletter, postalAddress: getPostalAddress(found.newsletter, siteExtensions.defaultPostalAddress) };
	return (
		<>
			<HeaderPage
				title={newsletter.name}
				backHref="/admin"
				icon={<AvatarNewsletter newsletter={newsletter} size={28} />}
				meta={<span className="text-sm text-muted-foreground">/{newsletter.slug}</span>}
			/>
			<ListDetails {...found} newsletter={newsletter} />
			{SIGNUP_EMAIL_KINDS.map((kind, index) => (
				<SectionSignupEmail key={kind} kind={kind} newsletter={newsletter} ownerEmail={found.ownerEmail} stagger={2 + index * 2} />
			))}
		</>
	);
}

function ListDetails({ newsletter, account, ownerEmail, alerts }) {
	const rows = [
		{
			label: "Account",
			value: (
				<>
					<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<Link href={`/admin?account=${account._id}`} className="truncate font-medium underline decoration-foreground/30 underline-offset-4">
							{ownerEmail ?? "Unknown owner"}
						</Link>
						<BadgeStatus status={getAccountStatus(account)} />
					</span>
					{isBlocked(account) && (
						<span className="block text-xs text-red-600 dark:text-red-400">
							Blocked by {describeBlocker(account.pausedBy)}
							{account.pauseReason ? `: ${account.pauseReason}` : ""}
						</span>
					)}
				</>
			),
		},
		{ label: "Sender", value: `${newsletter.fromName || newsletter.name} <${newsletter.fromEmail}>` },
		{ label: "Signups", value: newsletter.requireConfirmation ? "Confirm by email first" : "Join right away" },
		alerts.length > 0 && {
			label: "Alerts",
			value: (
				<ul className="flex flex-col gap-0.5">
					{alerts.map((alert) => (
						<li key={alert.id} className="flex gap-2">
							<span className="min-w-0 truncate">{alert.title}</span>
							<span className="shrink-0 text-muted-foreground tabular-nums">{formatRelative(alert.at)}</span>
						</li>
					))}
				</ul>
			),
		},
	].filter(Boolean);

	return (
		<dl className="divide-y divide-border rounded-xl bg-card text-sm shadow-border animate-enter">
			{rows.map(({ label, value }) => (
				<div key={label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 px-4 py-2.5">
					<dt className="text-muted-foreground">{label}</dt>
					<dd className="min-w-0">{value}</dd>
				</div>
			))}
		</dl>
	);
}

// The newsletter's own email of this kind and its check, or what goes out without one.
function SectionSignupEmail({ kind, newsletter, ownerEmail, stagger }) {
	const content = getOwnSignupEmail(newsletter, kind);
	const review = content ? getCurrentReview(newsletter, kind) : null;
	return (
		<section style={{ "--stagger": stagger }} className="mt-8 flex flex-col gap-3 animate-enter">
			<h2 className="text-base font-semibold tracking-tight">{TITLES[kind]}</h2>
			{!content && <p className="text-sm text-muted-foreground">{describeWithout(newsletter, kind)}</p>}
			{content && !review && <p className="text-sm text-muted-foreground">Not checked yet: the check reads it at its next save or send.</p>}
			{review && (
				<CardContentReview
					newsletterId={String(newsletter._id)}
					kind={kind}
					review={serialize(review)}
					isPending={review.outcome === "block" && !review.decision}
					ownerEmail={ownerEmail}
					stagger={stagger + 1}
				/>
			)}
			{content && (
				// No permissions at all: nothing in it runs, submits or navigates the page.
				<iframe
					title={TITLES[kind]}
					sandbox=""
					referrerPolicy="no-referrer"
					srcDoc={toPreviewHtml(renderEmail({ ...content, newsletter }).html)
						.replaceAll(CONFIRM_URL_PLACEHOLDER, "#")
						.replaceAll(KEEP_URL_PLACEHOLDER, "#")}
					className="mt-3 block h-[32rem] w-full rounded-xl bg-white shadow-border"
				/>
			)}
		</section>
	);
}

function describeWithout(newsletter, kind) {
	if (kind === "confirmation") return newsletter.requireConfirmation ? "The built-in one goes out." : "Off: new subscribers join without confirming.";
	if (kind === "lastChance") return newsletter.cleanup?.enabled ? "The built-in one goes out." : "Off: list cleanup is off.";
	return newsletter.requireConfirmation ? "Off: new subscribers get the confirmation email instead." : "Off.";
}

const TITLES = { confirmation: "Confirmation email", welcome: "Welcome email", lastChance: "Last-chance email" };
