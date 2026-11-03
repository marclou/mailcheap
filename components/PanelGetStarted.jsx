import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import ButtonNewCampaign from "@/components/ButtonNewCampaign";
import IconBrand, { AGENTS } from "@/components/IconBrand";
import ListSteps from "@/components/ListSteps";
import PickerTheme from "@/components/PickerTheme";
import ShellGetStarted from "@/components/ShellGetStarted";
import { Button } from "@/components/ui/button";
import { getGetStartedSteps, isGetStartedOpen } from "@/lib/get-started";
import { DESIGN_SECTION, getSectionPath } from "@/lib/newsletter-sections";
import { ADD_DOMAIN_PATH } from "@/lib/newsletters";
import { getSelectedNewsletter } from "@/lib/selected-newsletter";
import { getFontFaceCss, getFontStack } from "@/lib/theme-fonts";
import { ADAPTIVE_COLORS, THEME_PRESETS, resolveTheme } from "@/lib/themes";
import { cn } from "@/lib/utils";

// The open newsletter's steps to a first send (lib/get-started.js), on every dashboard page. Each one says what it
// takes and how to do it, or takes the click itself, like the design's themes; ListSteps opens the first one left that
// isn't optional. Keyed by newsletter: switching from one whose panel was just closed or finished still opens the next
// one's.
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
			<ListSteps
				nextId={nextId}
				steps={steps.map((step, index) => ({
					id: step.id,
					number: index + 1,
					title: STEPS[step.id].title,
					isDone: step.isDone,
					isOptional: Boolean(step.isOptional),
					decoration: step.id === "agent" ? <IconsAgents /> : null,
					content: <ContentStep id={step.id} link={getLink(step.id, draftId)} newsletterId={newsletterId} />,
				}))}
			/>
		</ShellGetStarted>
	);
}

// The docs open in a new tab, so the dashboard and this list stay where they were.
function ContentStep({ id, link, newsletterId }) {
	const isDocs = link.href.startsWith("/docs");
	const Arrow = isDocs ? ArrowUpRight : ArrowRight;
	return (
		<>
			<p className="text-sm text-pretty text-muted-foreground">{STEPS[id].description}</p>
			{id === "design" ? (
				<>
					<style dangerouslySetInnerHTML={{ __html: THEME_FONT_FACES }} />
					<PickerTheme newsletterId={newsletterId} themes={THEME_TILES} designPath={DESIGN_PATH} />
				</>
			) : id === "write" ? (
				<ButtonNewCampaign newsletterId={newsletterId} label="New draft" size="sm" />
			) : (
				<Button asChild size="sm">
					<Link href={link.href} target={isDocs ? "_blank" : undefined}>
						{link.label}
						<Arrow data-icon="inline-end" />
					</Link>
				</Button>
			)}
		</>
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

const DESIGN_PATH = getSectionPath(DESIGN_SECTION.id);

const STEPS = {
	design: {
		title: "Choose your design",
		description: "Pick the look of your website and emails. You can change it anytime.",
		href: DESIGN_PATH,
		action: "Open design",
	},
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

// The design step's tiles: each theme's colors, MailCheap's following the dashboard's light or dark mode, and its
// heading font, whose files only load while the tiles show. The dashboard has Geist already.
const THEMES = THEME_PRESETS.map(({ id }) => resolveTheme({ preset: id }));
const THEME_TILES = THEMES.map(({ id, name, isAdaptive, colors, fonts, headingWeight, tracking }) => ({
	id,
	name,
	colors: isAdaptive ? ADAPTIVE_COLORS : colors,
	font: {
		...(fonts.heading.id !== "geist" && { fontFamily: getFontStack(fonts.heading) }),
		fontWeight: headingWeight,
		letterSpacing: `${tracking}em`,
	},
}));
const THEME_FONT_FACES = getFontFaceCss(THEMES.map(({ fonts }) => fonts.heading).filter(({ id }) => id !== "geist"));
