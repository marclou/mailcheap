import { Suspense } from "react";
import Link from "next/link";
import { ArrowUpRight, ClipboardList, Gift, HeartHandshake, TriangleAlert, UserPlus } from "lucide-react";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import BadgeStatus from "@/components/BadgeStatus";
import { ButtonDisconnectSparkLoop, ButtonSetUpWebhook } from "@/components/ButtonSparkLoopSettings";
import CardConnectSparkLoop from "@/components/CardConnectSparkLoop";
import FormLinkPublication from "@/components/FormLinkPublication";
import GraphicSparkLoop from "@/components/GraphicSparkLoop";
import HeaderPage from "@/components/HeaderPage";
import SectionPage from "@/components/SectionPage";
import { NoticeError, NoticeReconnect } from "@/components/ShellSparkLoop";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { connectDb } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { createSparkLoop } from "@/lib/sparkloop";
import { getSparkLoopConnection } from "@/lib/sparkloop-account";
import { SPARKLOOP_FEATURES, SPARKLOOP_INTRO, SPARKLOOP_URLS } from "@/lib/sparkloop-content";
import { canReceiveWebhooks } from "@/lib/sparkloop-webhook";
import { cn } from "@/lib/utils";
import Newsletter from "@/models/Newsletter";

export const metadata = { title: "SparkLoop" };

const FEATURE_LINKS = [
	{ feature: "signup-flow", href: "/sparkloop/signup-flow", icon: UserPlus },
	{ feature: "survey", href: "/sparkloop/survey", icon: ClipboardList },
	{ feature: "offers", href: "/sparkloop/offers", icon: Gift },
	{ feature: "recommendations", href: "/sparkloop/recommendations", icon: HeartHandshake },
];

export default async function SparkLoopPage() {
	const connection = await getSparkLoopConnection();

	return (
		<>
			<HeaderPage title="SparkLoop">
				<Button asChild variant="outline">
					<a href={SPARKLOOP_URLS.dashboard} target="_blank" rel="noopener">
						Open SparkLoop
						<ArrowUpRight data-icon="inline-end" className="opacity-60" />
					</a>
				</Button>
			</HeaderPage>
			{connection.status === "connected" ? (
				<SectionsConnected connection={connection} />
			) : (
				<SectionsConnect hint={connection.status === "unreadable" ? connection.hint : null} />
			)}
		</>
	);
}

// The key was sealed with another SESSION_SECRET: the same card, after saying why.
function SectionsConnect({ hint }) {
	return (
		<div className="flex flex-col gap-8">
			{hint !== null && hint !== undefined && <NoticeReconnect hint={hint} />}
			<section className="grid items-center gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:gap-12">
				<div className="flex flex-col gap-5 animate-enter">
					<h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{SPARKLOOP_INTRO.headline}</h2>
					<p className="max-w-xl text-sm leading-relaxed text-pretty text-muted-foreground sm:text-base">
						{SPARKLOOP_INTRO.body}
					</p>
					<ListFeatures />
				</div>
				<GraphicSparkLoop feature="signup-flow" className="animate-enter [--stagger:1]" />
			</section>
			<div style={{ "--stagger": 2 }} className="animate-enter">
				<CardConnectSparkLoop />
			</div>
		</div>
	);
}

function ListFeatures() {
	return (
		<ul className="grid gap-2 sm:grid-cols-2">
			{FEATURE_LINKS.map(({ feature, href, icon: Icon }) => (
				<li key={feature}>
					<Link
						href={href}
						className="flex h-full items-start gap-3 rounded-xl p-3 shadow-border transition-shadow duration-150 hover:shadow-border-hover"
					>
						<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
							<Icon className="size-4" />
						</span>
						<span className="min-w-0">
							<span className="block text-sm font-medium">{SPARKLOOP_FEATURES[feature].title}</span>
							<span className="block text-xs text-pretty text-muted-foreground">
								{SPARKLOOP_FEATURES[feature].headline}
							</span>
						</span>
					</Link>
				</li>
			))}
		</ul>
	);
}

async function SectionsConnected({ connection }) {
	await connectDb();
	const newsletters = await Newsletter.find().sort({ createdAt: 1 }).select("name slug imageUrl sparkloop").lean();

	return (
		<div className="flex flex-col gap-8">
			<SectionPage title="Account">
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card p-4 shadow-border">
					<Suspense fallback={<Skeleton className="h-6 w-56" />}>
						<TextAccount apiKey={connection.apiKey} />
					</Suspense>
					<div className="flex items-center gap-3">
						<span className="font-mono text-xs text-muted-foreground">••••{connection.hint}</span>
						<span className="hidden text-xs text-muted-foreground sm:inline">since {formatDate(connection.connectedAt)}</span>
						<ButtonDisconnectSparkLoop />
					</div>
				</div>
			</SectionPage>

			<SectionPage title="Newsletters" stagger={1}>
				<Suspense fallback={<Skeleton className="h-32 rounded-xl" />}>
					<ListNewsletters apiKey={connection.apiKey} newsletters={newsletters} />
				</Suspense>
			</SectionPage>

			<SectionPage title="Readers from SparkLoop" stagger={2}>
				<CardReferrals isOn={Boolean(connection.webhookUuid)} />
			</SectionPage>
		</div>
	);
}

// Readers other newsletters send arrive through the webhook; without it they're lost, so it says so.
function CardReferrals({ isOn }) {
	const canReceive = canReceiveWebhooks();
	return (
		<div
			className={cn(
				"flex flex-wrap items-center justify-between gap-3 rounded-xl p-4",
				isOn
					? "bg-card shadow-border"
					: "bg-amber-50 ring-1 ring-amber-500/30 dark:bg-amber-500/10"
			)}
		>
			<div className="flex min-w-0 flex-1 items-start gap-3">
				{!isOn && <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />}
				<div className="min-w-0">
					<p className="text-sm font-medium">
						{isOn ? "Readers other newsletters send you join your list" : "Readers other newsletters send you aren't reaching your list"}
					</p>
					<p className="mt-0.5 text-sm text-pretty text-muted-foreground">
						{isOn
							? "SparkLoop sends them to Mailcheap, which adds them to the linked newsletter with source sparkloop. Confirmed opt-in still applies."
							: canReceive
								? "Set it up so SparkLoop sends them here."
								: "SparkLoop only sends to a public https:// address. Set APP_URL to your deployed URL, then set this up."}
					</p>
				</div>
			</div>
			{isOn ? <BadgeStatus status="active" label="On" /> : canReceive && <ButtonSetUpWebhook />}
		</div>
	);
}

// A key SparkLoop no longer accepts (revoked, or another account's) shows here, not as "Connected".
async function TextAccount({ apiKey }) {
	let account = null;
	let error = null;
	try {
		({ account } = await createSparkLoop(apiKey).getAccount());
	} catch (caught) {
		error = caught;
	}
	if (!account) {
		return (
			<span className="flex min-w-0 items-center gap-3">
				<BadgeStatus status={error?.status === 401 ? "failed" : "pending"} label={error?.status === 401 ? "Key not accepted" : "Unreachable"} />
				<span className="truncate text-sm text-muted-foreground">
					{error?.status === 401 ? "Paste a new key from SparkLoop after disconnecting." : error?.message}
				</span>
			</span>
		);
	}
	return (
		<span className="flex min-w-0 items-center gap-3">
			<BadgeStatus status="active" label="Connected" />
			<span className="min-w-0 truncate text-sm">
				<span className="font-medium">{account.name}</span>
				{account.owner?.email && <span className="text-muted-foreground"> · {account.owner.email}</span>}
			</span>
		</span>
	);
}

async function ListNewsletters({ apiKey, newsletters }) {
	if (newsletters.length === 0) {
		return (
			<p className="rounded-xl px-4 py-6 text-center text-sm text-muted-foreground shadow-border">
				<Link href="/newsletters/new" className="underline underline-offset-2">
					Create a newsletter
				</Link>{" "}
				to link it to SparkLoop
			</p>
		);
	}

	let publications;
	try {
		({ publications = [] } = await createSparkLoop(apiKey).listPublications());
	} catch (error) {
		return <NoticeError error={error.message} href={SPARKLOOP_URLS.apiKey} />;
	}
	const options = publications.map(({ uuid, name }) => ({ uuid, name }));

	return (
		<ul className="divide-y divide-border/60 rounded-xl bg-card shadow-border">
			{newsletters.map((newsletter) => (
				<li key={newsletter._id.toString()} className="flex flex-wrap items-center justify-between gap-3 p-4">
					<div className="flex min-w-0 items-center gap-3">
						<AvatarNewsletter newsletter={newsletter} size={32} />
						<div className="min-w-0">
							<p className="truncate text-sm font-medium">{newsletter.name}</p>
							<p className="text-xs text-muted-foreground">
								{!newsletter.sparkloop?.publicationUuid
									? "Not linked yet"
									: newsletter.sparkloop.signupFlowEnabled
										? "Signup flow on its forms"
										: "Signup flow off"}
							</p>
						</div>
					</div>
					<FormLinkPublication
						newsletterId={newsletter._id.toString()}
						publications={options}
						selectedUuid={newsletter.sparkloop?.publicationUuid}
						isCompact
					/>
				</li>
			))}
		</ul>
	);
}
