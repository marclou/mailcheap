import { ArrowRight, Check, Gift, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// Small drawings of each SparkLoop feature for the pitch pages, made of the app's own surfaces.
export default function GraphicSparkLoop({ feature, className }) {
	const Graphic = GRAPHICS[feature] ?? GraphicSignupFlow;
	return (
		<div
			aria-hidden="true"
			className={cn(
				"relative isolate flex min-h-80 items-center justify-center overflow-hidden rounded-2xl bg-muted/50 p-6 select-none sm:p-10",
				className
			)}
		>
			<div className="pointer-events-none absolute inset-0 -z-10 bg-dots" />
			<Graphic />
		</div>
	);
}

function GraphicSignupFlow() {
	return (
		<div className="relative w-full max-w-xs">
			<div className="rounded-2xl bg-card p-4 shadow-border-hover animate-enter">
				<div className="flex items-center gap-2">
					<span className="grid size-6 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
						<Check className="size-3.5" />
					</span>
					<p className="text-sm font-semibold tracking-tight">You&apos;re subscribed!</p>
				</div>
				<p className="mt-1.5 text-xs text-muted-foreground">Readers like you also enjoy:</p>
				<ul className="mt-3 flex flex-col gap-1.5">
					{NEWSLETTERS.map(({ name, tone, checked }, index) => (
						<li
							key={name}
							style={{ "--stagger": index + 1 }}
							className="flex items-center gap-2.5 rounded-lg p-1.5 shadow-border animate-enter"
						>
							<span className={cn("size-7 shrink-0 rounded-md", tone)} />
							<span className="min-w-0 flex-1">
								<span className="block truncate text-xs font-medium">{name}</span>
								<span className="mt-1 block h-1.5 w-16 rounded-full bg-muted" />
							</span>
							<span
								className={cn(
									"grid size-4 shrink-0 place-items-center rounded-[5px] border",
									checked ? "border-foreground bg-foreground text-background" : "border-border"
								)}
							>
								{checked && <Check className="size-3" />}
							</span>
						</li>
					))}
				</ul>
				<div className="mt-3 flex h-8 items-center justify-center gap-1.5 rounded-lg bg-foreground text-xs font-medium text-background">
					Subscribe to selected
					<ArrowRight className="size-3.5" />
				</div>
			</div>
			<ChipEarning className="-top-4 -right-6" label="+$2.40" note="paid recommendation" />
			<ChipEarning className="-bottom-5 -left-7" label="+$1.80" note="offer claimed" stagger={4} />
		</div>
	);
}

function GraphicSurvey() {
	return (
		<div className="relative w-full max-w-xs">
			<div className="rounded-2xl bg-card p-4 shadow-border-hover animate-enter">
				<p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Welcome survey</p>
				<p className="mt-1 text-sm font-semibold tracking-tight">What do you do for work?</p>
				<ul className="mt-3 flex flex-col gap-2">
					{SURVEY_ANSWERS.map(({ label, share }, index) => (
						<li key={label} style={{ "--stagger": index + 1 }} className="animate-enter">
							<div className="flex items-baseline justify-between text-xs">
								<span className="font-medium">{label}</span>
								<span className="text-muted-foreground tabular-nums">{share}%</span>
							</div>
							<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
								<div
									className="h-full rounded-full bg-foreground/70"
									style={{ width: `${share}%` }}
								/>
							</div>
						</li>
					))}
				</ul>
			</div>
			<div
				style={{ "--stagger": 5 }}
				className="absolute -right-8 -bottom-6 flex items-center gap-2 rounded-xl bg-card px-3 py-2 text-xs shadow-border-hover animate-enter"
			>
				<span className="grid size-6 place-items-center rounded-full bg-muted font-semibold">J</span>
				<span>
					<span className="block font-medium">jane@example.com</span>
					<span className="text-muted-foreground">answered 3 questions</span>
				</span>
			</div>
		</div>
	);
}

function GraphicOffers() {
	return (
		<div className="relative w-full max-w-xs">
			<div className="overflow-hidden rounded-2xl bg-card shadow-border-hover animate-enter">
				<div className="relative grid h-28 place-items-center bg-muted text-muted-foreground">
					<Gift className="size-7" />
					<span className="absolute top-3 left-3 rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase shadow-border">
						Sponsored
					</span>
				</div>
				<div className="p-4">
					<div className="flex items-center gap-2">
						<span className="size-6 rounded-md bg-zinc-900 dark:bg-zinc-100" />
						<span className="text-xs font-semibold">Acme Notes</span>
					</div>
					<p className="mt-2 text-sm font-semibold tracking-tight">Write 2× faster with Acme</p>
					<div className="mt-1.5 flex flex-col gap-1">
						<span className="h-1.5 w-full rounded-full bg-muted" />
						<span className="h-1.5 w-3/4 rounded-full bg-muted" />
					</div>
					<div className="mt-3 inline-flex h-7 items-center gap-1 rounded-lg bg-foreground px-3 text-xs font-medium text-background">
						Claim offer
						<ArrowRight className="size-3" />
					</div>
				</div>
			</div>
			<ChipEarning className="-top-4 -right-8" label="$2.00" note="per lead" />
			<ChipEarning className="-bottom-4 -left-8" label="$250" note="per sale" stagger={3} />
		</div>
	);
}

function GraphicRecommendations() {
	return (
		<div className="relative flex w-full max-w-sm items-center justify-center gap-3">
			<CardMiniNewsletter name="Your newsletter" tone="bg-foreground" className="-rotate-3" />
			<div style={{ "--stagger": 2 }} className="flex flex-col items-center gap-1 animate-enter">
				<span className="grid size-9 place-items-center rounded-full bg-card shadow-border">
					<Sparkles className="size-4 text-muted-foreground" />
				</span>
				<span className="text-[10px] font-medium text-muted-foreground">recommends</span>
			</div>
			<CardMiniNewsletter name="The Weekly Wire" tone="bg-gradient-to-br from-sky-400 to-indigo-500" className="rotate-3" stagger={1} />
			<div
				style={{ "--stagger": 4 }}
				className="absolute -bottom-10 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-card py-1.5 pr-3 pl-1.5 text-xs whitespace-nowrap shadow-border-hover animate-enter"
			>
				<span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
					Free swap
				</span>
				they recommend you back
			</div>
		</div>
	);
}

function CardMiniNewsletter({ name, tone, className, stagger = 0 }) {
	return (
		<div style={{ "--stagger": stagger }} className="animate-enter">
			<div
				className={cn(
					"w-32 rounded-2xl bg-card p-3 shadow-border-hover",
					className
				)}
			>
				<span className={cn("block size-9 rounded-xl", tone)} />
				<p className="mt-2.5 truncate text-xs font-semibold">{name}</p>
				<span className="mt-1.5 block h-1.5 w-full rounded-full bg-muted" />
				<span className="mt-1 block h-1.5 w-2/3 rounded-full bg-muted" />
				<span className="mt-2.5 flex h-6 items-center justify-center rounded-md bg-muted text-[10px] font-medium">
					Subscribe
				</span>
			</div>
		</div>
	);
}

function ChipEarning({ label, note, className, stagger = 2 }) {
	return (
		<div
			style={{ "--stagger": stagger }}
			className={cn(
				"absolute flex items-center gap-2 rounded-full bg-card py-1.5 pr-3 pl-1.5 text-xs whitespace-nowrap shadow-border-hover animate-enter",
				className
			)}
		>
			<span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
				{label}
			</span>
			<span className="text-muted-foreground">{note}</span>
		</div>
	);
}

const NEWSLETTERS = [
	{ name: "Daily Signal", tone: "bg-gradient-to-br from-amber-300 to-orange-500", checked: true },
	{ name: "The Weekly Wire", tone: "bg-gradient-to-br from-sky-400 to-indigo-500", checked: true },
	{ name: "Pixel Pushers", tone: "bg-gradient-to-br from-emerald-300 to-teal-600", checked: false },
];

const SURVEY_ANSWERS = [
	{ label: "Founder", share: 46 },
	{ label: "Marketing", share: 28 },
	{ label: "Engineering", share: 17 },
	{ label: "Something else", share: 9 },
];

const GRAPHICS = {
	"signup-flow": GraphicSignupFlow,
	survey: GraphicSurvey,
	offers: GraphicOffers,
	recommendations: GraphicRecommendations,
};
