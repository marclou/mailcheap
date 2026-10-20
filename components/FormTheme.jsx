"use client";

import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { Check, ChevronLeft, Loader2, Mail, Monitor, RotateCcw, SlidersHorizontal } from "lucide-react";
import { saveTheme } from "@/app/(app)/newsletters/actions";
import BarSave from "@/components/BarSave";
import FieldsTheme from "@/components/FieldsTheme";
import PreviewEmail from "@/components/PreviewEmail";
import { PreviewThemeCard, PreviewThemeSite } from "@/components/PreviewTheme";
import { Button } from "@/components/ui/button";
import { UNSUBSCRIBE_PLACEHOLDER, renderEmail } from "@/lib/render-email";
import { THEME_PRESETS, getThemeOutput, normalizeTheme, resolveTheme } from "@/lib/themes";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// Design: the presets as cards, each showing the newsletter's website and an email in it. A click applies one at once,
// with an undo; Customize changes its colors, fonts and shapes with both previews live, saved with the bar like the
// other settings. The draft holds a theme's full values: saving sends them all, so nothing left from before survives.
export default function FormTheme({ newsletter, postalAddress }) {
	const [saved, setSaved] = useState(() => toValues(newsletter.theme));
	const [draft, setDraft] = useState(saved);
	const [savedAt, setSavedAt] = useState(null);
	const [isCustomizing, setIsCustomizing] = useState(false);
	const [applyingId, setApplyingId] = useState(null);
	const [isSaving, startSaving] = useTransition();
	const isDirty = toKey(draft) !== toKey(saved);

	function apply(presetId) {
		if (presetId === saved.preset) return setIsCustomizing(true);
		const previous = saved;
		const next = toValues({ preset: presetId });
		setSaved(next);
		setDraft(next);
		setApplyingId(presetId);
		startSaving(async () => {
			const result = await saveTheme(newsletter._id, { preset: presetId });
			setApplyingId(null);
			if (result?.error) {
				setSaved(previous);
				setDraft(previous);
				return void toast.error(result.error);
			}
			toast.success(`${getPresetName(presetId)} applied`, { action: { label: "Undo", onClick: () => restore(previous) } });
		});
	}

	function restore(values) {
		setSaved(values);
		setDraft(values);
		startSaving(async () => {
			const result = await saveTheme(newsletter._id, values);
			if (result?.error) toast.error(result.error);
		});
	}

	function save(event) {
		event.preventDefault();
		const values = draft;
		startSaving(async () => {
			const result = await saveTheme(newsletter._id, values);
			if (result?.error) return void toast.error(result.error);
			setSaved(values);
			setSavedAt(Date.now());
		});
	}

	function discard() {
		setDraft(saved);
		setSavedAt(null);
	}

	return (
		<form onSubmit={save}>
			{isCustomizing ? (
				<PanelCustomize
					newsletter={newsletter}
					postalAddress={postalAddress}
					draft={draft}
					onChange={setDraft}
					onBack={() => setIsCustomizing(false)}
				/>
			) : (
				<ul className="grid gap-5 sm:grid-cols-2">
					{THEME_PRESETS.map((preset, index) => (
						<CardTheme
							key={preset.id}
							preset={preset}
							values={preset.id === saved.preset ? draft : toValues({ preset: preset.id })}
							newsletter={newsletter}
							isApplied={preset.id === saved.preset}
							isApplying={applyingId === preset.id}
							stagger={index}
							onApply={() => apply(preset.id)}
							onCustomize={() => setIsCustomizing(true)}
						/>
					))}
				</ul>
			)}
			<BarSave isDirty={isDirty} isSaving={isSaving && !applyingId} savedAt={savedAt} onDiscard={discard} />
		</form>
	);
}

function CardTheme({ preset, values, newsletter, isApplied, isApplying, stagger, onApply, onCustomize }) {
	const resolved = useMemo(() => resolveTheme(values), [values]);
	return (
		<li
			style={{ "--stagger": stagger }}
			className={cn(
				"group/card overflow-hidden rounded-2xl bg-card shadow-border transition-[box-shadow,translate] duration-200 ease-out animate-enter [@media(hover:hover)]:hover:-translate-y-0.5 [@media(hover:hover)]:hover:shadow-border-hover",
				isApplied && "ring-2 ring-foreground ring-offset-2 ring-offset-background"
			)}
		>
			<button
				type="button"
				onClick={onApply}
				aria-label={isApplied ? `Customize ${preset.name}` : `Use ${preset.name}`}
				className="block w-full text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
			>
				<PreviewThemeCard theme={resolved} newsletter={newsletter} />
			</button>
			<div className={cn("flex h-12 items-center justify-between gap-3 border-t border-border/60 pl-4", isApplied ? "pr-2" : "pr-4")}>
				<span className="flex min-w-0 items-center gap-2 text-sm font-medium">
					<span className="truncate">{preset.name}</span>
					{isApplying ? (
						<Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Applying" />
					) : (
						isApplied && (
							<span className="grid size-4.5 shrink-0 place-items-center rounded-full bg-foreground text-background">
								<Check className="size-3 animate-icon-in" strokeWidth={3} aria-label="Applied" />
							</span>
						)
					)}
					{isApplied && resolved.isCustomized && <span className="truncate text-xs font-normal text-muted-foreground">Customized</span>}
				</span>
				<span className="flex shrink-0 items-center gap-3">
					<ListPalette colors={resolved.isAdaptive ? ADAPTIVE_COLORS : resolved.colors} />
					{isApplied && (
						<Button type="button" size="sm" onClick={onCustomize}>
							<SlidersHorizontal />
							Customize
						</Button>
					)}
				</span>
			</div>
		</li>
	);
}

// The theme's page, text and accent, at a glance. Hovering the card spreads them apart a little.
function ListPalette({ colors }) {
	return (
		<span aria-hidden="true" className="flex items-center px-1">
			{PALETTE.map(({ key, spread }) => (
				<span
					key={key}
					style={{ backgroundColor: colors[key] }}
					className={cn(
						"size-3.5 rounded-full shadow-[0_0_0_2px_var(--card),inset_0_0_0_1px_rgb(0_0_0/0.12)] transition-[translate] duration-200 ease-out not-first:-ml-1 dark:shadow-[0_0_0_2px_var(--card),inset_0_0_0_1px_rgb(255_255_255/0.16)]",
						spread
					)}
				/>
			))}
		</span>
	);
}

function PanelCustomize({ newsletter, postalAddress, draft, onChange, onBack }) {
	const [view, setView] = useState("website");
	const resolved = useMemo(() => resolveTheme(draft), [draft]);
	const deferredDraft = useDeferredValue(draft);
	const emailHtml = useMemo(
		() =>
			renderEmail({
				markdown: SAMPLE_EMAIL,
				subject: "This week",
				newsletter: { name: newsletter.name, postalAddress, theme: deferredDraft },
			}).html.replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#"),
		[deferredDraft, newsletter.name, postalAddress]
	);

	// From lg, both panels take the screen's height below the page's title, the controls scrolling in theirs.
	return (
		<div className="grid gap-5 animate-enter lg:h-[max(34rem,calc(100dvh-var(--plan-bar-height)-11.75rem))] lg:grid-cols-[20rem_minmax(0,1fr)]">
			<div className="flex flex-col rounded-xl bg-card shadow-border lg:min-h-0">
				<div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/60 pr-2 pl-1.5">
					<button
						type="button"
						onClick={onBack}
						className="flex h-9 items-center gap-1 rounded-lg pr-2.5 pl-1.5 text-sm font-medium transition-[color,background-color,scale] duration-150 ease-out hover:bg-muted active:scale-[0.96]"
					>
						<ChevronLeft className="size-4 text-muted-foreground" />
						{resolved.name}
					</button>
					{resolved.isCustomized && (
						<Button type="button" variant="ghost" size="sm" onClick={() => onChange(toValues({ preset: draft.preset }))}>
							<RotateCcw />
							Reset
						</Button>
					)}
				</div>
				<div className="p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:[scrollbar-width:thin]">
					<FieldsTheme values={draft} onChange={onChange} />
				</div>
			</div>
			<div className="order-first flex flex-col gap-3 lg:order-none lg:min-h-0">
				<div role="tablist" aria-label="Preview" className="flex w-fit shrink-0 gap-1 rounded-xl bg-muted p-1">
					{VIEWS.map(({ id, label, icon: Icon }) => (
						<button
							key={id}
							type="button"
							role="tab"
							aria-selected={view === id}
							onClick={() => setView(id)}
							className={cn(
								"flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-[color,background-color,box-shadow,scale] duration-150 ease-out hover:text-foreground active:scale-[0.96]",
								view === id && "bg-background text-foreground shadow-border"
							)}
						>
							<Icon className="size-4" aria-hidden="true" />
							{label}
						</button>
					))}
				</div>
				{view === "website" ? (
					<div className="h-[min(62svh,40rem)] overflow-y-auto overscroll-contain rounded-xl shadow-border lg:h-auto lg:min-h-0 lg:flex-1">
						<PreviewThemeSite theme={resolved} newsletter={newsletter} />
					</div>
				) : (
					<PreviewEmail
						html={emailHtml}
						sender={{ name: newsletter.name, fromName: newsletter.fromName, fromEmail: newsletter.fromEmail, imageUrl: newsletter.imageUrl }}
						subject="This week"
						className="lg:min-h-0 lg:flex-1"
					/>
				)}
			</div>
		</div>
	);
}

// The values the customizer edits and saving sends, from a stored theme.
function toValues(theme) {
	const { name, customized, ...values } = getThemeOutput(theme);
	return values;
}

function toKey(values) {
	return JSON.stringify(normalizeTheme(values));
}

function getPresetName(id) {
	return THEME_PRESETS.find((preset) => preset.id === id)?.name ?? "Theme";
}

const VIEWS = [
	{ id: "website", label: "Website", icon: Monitor },
	{ id: "email", label: "Email", icon: Mail },
];
// MailCheap's own colors follow the dashboard's light or dark mode, like its preview.
const ADAPTIVE_COLORS = { background: "var(--background)", text: "var(--foreground)", accent: "var(--primary)" };
// Without reduced motion, the outer dots move out past their overlap.
const PALETTE = [
	{ key: "background", spread: "motion-safe:group-hover/card:-translate-x-1.5" },
	{ key: "text", spread: "" },
	{ key: "accent", spread: "motion-safe:group-hover/card:translate-x-1.5" },
];

const SAMPLE_EMAIL = `# Notes from the road

Thanks for reading. Here's what I found this week, in five minutes or less.

## Worth your time

An [essay on doing fewer things](https://example.com) that I keep coming back to, and **one thing I'd do again**.

> Make it work, make it right, make it fast.

:::box
Reply to this email: I read every answer.
:::

<a href="#" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;">Read the full issue</a>
`;
