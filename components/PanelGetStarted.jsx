import Link from "next/link";
import { ArrowRight, ArrowUpRight, ChevronRight } from "lucide-react";
import ButtonNewCampaign from "@/components/ButtonNewCampaign";
import CircleStep from "@/components/CircleStep";
import IconBrand, { AGENTS } from "@/components/IconBrand";
import ShellGetStarted from "@/components/ShellGetStarted";
import { Button } from "@/components/ui/button";
import { getGetStartedSteps, isGetStartedOpen } from "@/lib/get-started";
import { ADD_DOMAIN_PATH } from "@/lib/newsletters";
import { getSelectedNewsletter } from "@/lib/selected-newsletter";
import { cn } from "@/lib/utils";

// The open newsletter's steps to a first send (lib/get-started.js), on every dashboard page. The first one left that
// isn't optional says how to do it; the others link to where they're done. Keyed by newsletter: switching from one
// whose panel was just closed or finished still opens the next one's.
export default async function PanelGetStarted({ account }) {
	const { selected } = await getSelectedNewsletter();
	if (!isGetStartedOpen(account, selected)) return null;
	const newsletterId = String(selected._id);
	const { steps, draftId, isFinished } = await getGetStartedSteps(account, selected._id);
	const doneCount = steps.filter(({ isDone }) => isDone).length;
	const nextId = steps.find(({ isDone, isOptional }) => !isDone && !isOptional)?.id;

	return (
		<ShellGetStarted key={newsletterId} newsletterId={newsletterId} done={doneCount} total={steps.length} isFinished={isFinished}>
			<header className="px-3 pt-2.5 pb-3">
				<h2 id="get-started-title" className="pr-16 font-semibold tracking-tight">
					Get started
				</h2>
				<ProgressSteps done={doneCount} total={steps.length} />
			</header>
			<ol className="flex flex-col gap-0.5">
				{steps.map((step, index) => (
					<ItemStep
						key={step.id}
						step={step}
						number={index + 1}
						isNext={step.id === nextId}
						link={getLink(step.id, draftId)}
						newsletterId={newsletterId}
					/>
				))}
			</ol>
		</ShellGetStarted>
	);
}

// The docs open in a new tab, so the dashboard and this list stay where they were.
function ItemStep({ step, number, isNext, link, newsletterId }) {
	const { title, description } = STEPS[step.id];
	const isDocs = link.href.startsWith("/docs");
	const target = isDocs ? "_blank" : undefined;

	if (step.isDone) {
		return (
			<li className="flex h-10 items-center gap-3 px-3 text-sm text-muted-foreground">
				<CircleStep isDone />
				<span className="truncate">{title}</span>
				<span className="sr-only">(done)</span>
			</li>
		);
	}

	if (isNext) {
		const Arrow = isDocs ? ArrowUpRight : ArrowRight;
		return (
			<li aria-current="step" className="group flex gap-3 rounded-lg bg-muted/60 px-3 py-3">
				<CircleStep number={number} isNext />
				<div className="flex min-w-0 flex-1 flex-col items-start gap-3 pt-0.5">
					<div>
						<p className="flex items-center gap-2.5 text-sm font-medium">
							{title}
							{step.id === "agent" && <IconsAgents />}
						</p>
						<p className="text-sm text-muted-foreground">{description}</p>
					</div>
					{step.id === "write" ? (
						<ButtonNewCampaign newsletterId={newsletterId} label="New draft" size="sm" />
					) : (
						<Button asChild size="sm">
							<Link href={link.href} target={target}>
								{link.label}
								<Arrow data-icon="inline-end" />
							</Link>
						</Button>
					)}
				</div>
			</li>
		);
	}

	const Arrow = isDocs ? ArrowUpRight : ChevronRight;
	return (
		<li>
			<Link
				href={link.href}
				target={target}
				className="group flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-150 hover:bg-muted/60"
			>
				<CircleStep number={number} />
				<span className="truncate">{title}</span>
				{step.id === "agent" && <IconsAgents />}
				{step.isOptional && (
					<span className="inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs text-muted-foreground inset-ring inset-ring-foreground/10">
						Optional
					</span>
				)}
				<Arrow className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
			</Link>
		</li>
	);
}

function IconsAgents() {
	return (
		<span className="hidden shrink-0 items-center gap-1 opacity-70 grayscale transition-[opacity,filter] duration-150 group-hover:opacity-100 group-hover:grayscale-0 sm:flex">
			{AGENTS.map(({ id }) => (
				<IconBrand key={id} brand={id} className="size-4" />
			))}
		</span>
	);
}

function ProgressSteps({ done, total }) {
	return (
		<div className="mt-2.5 flex items-center gap-3">
			<div
				role="progressbar"
				aria-label="Steps done"
				aria-valuemin={0}
				aria-valuemax={total}
				aria-valuenow={done}
				aria-valuetext={`${done} of ${total}`}
				className="flex flex-1 gap-1"
			>
				{Array.from({ length: total }, (_, index) => (
					<span
						key={index}
						className={cn(
							"h-1.5 flex-1 rounded-full transition-colors duration-300",
							index < done ? "bg-foreground" : "bg-foreground/10"
						)}
					/>
				))}
			</div>
			<span aria-hidden="true" className="text-sm text-muted-foreground tabular-nums">
				{done} of {total}
			</span>
		</div>
	);
}

function getLink(id, draftId) {
	if (id === "send" && draftId) return { href: `/campaigns/${draftId}`, label: "Open draft" };
	return { href: STEPS[id].href, label: STEPS[id].action };
}

const STEPS = {
	write: {
		title: "Write your first issue",
		description: "Start a draft in the editor. It saves as you type.",
		href: "/campaigns",
		action: "Open campaigns",
	},
	subscribers: {
		title: "Add your subscribers",
		description: "Import a CSV, take signups on your site, or add them with the API or by hand.",
		href: "/contacts",
		action: "Add contacts",
	},
	agent: {
		title: "Connect your AI agent",
		description: "Write, test and schedule issues from ChatGPT, Claude, Cursor, Codex or Grok Bot.",
		href: "/docs/mcp",
		action: "Connect",
	},
	domain: {
		title: "Send from your domain",
		description: "Add its DNS records, then send from your address.",
		href: ADD_DOMAIN_PATH,
		action: "Add a domain",
	},
	send: {
		title: "Send your first issue",
		description: "Open your draft, then send it now or schedule it.",
		href: "/campaigns",
		action: "Open campaigns",
	},
};
