"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowLeft, ArrowUpRight, Gift, HeartHandshake, Loader2, Search } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { createCardLink, listCardOptions } from "@/app/(app)/sparkloop/actions";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CARD_LIMITS, DEFAULT_CARD_TEXT, SPONSORED_LABEL, getCardLabel, isSponsored } from "@/lib/sparkloop-cards";
import { cn } from "@/lib/utils";

const KINDS = [
	{ kind: "offer", label: "Offers", icon: Gift, page: "/sparkloop/offers" },
	{ kind: "recommendation", label: "Recommendations", icon: HeartHandshake, page: "/sparkloop/recommendations" },
];

// A new card ({ kind }): pick one of the newsletter's SparkLoop offers or recommendations, change the
// wording, and it's inserted with its own tracked link. An existing card ({ kind, attrs }): its wording.
export default function DialogSparkLoopCard({ request, newsletterId, onOpenChange, onSave }) {
	function save(attrs) {
		onSave(attrs);
		onOpenChange(false);
	}

	return (
		<Dialog open={Boolean(request)} onOpenChange={onOpenChange}>
			<DialogContent className="gap-0 p-0 sm:max-w-xl">
				{request?.attrs && <FormCard option={request.attrs} newsletterId={newsletterId} onSave={save} isEditing />}
				{request && !request.attrs && <PickerCard initialKind={request.kind} newsletterId={newsletterId} onSave={save} />}
			</DialogContent>
		</Dialog>
	);
}

function PickerCard({ initialKind, newsletterId, onSave }) {
	const [kind, setKind] = useState(initialKind);
	const [options, setOptions] = useState(null);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(null);

	useEffect(() => {
		let isCurrent = true;
		listCardOptions(newsletterId).then((result) => isCurrent && setOptions(result));
		return () => {
			isCurrent = false;
		};
	}, [newsletterId]);

	if (selected) {
		return <FormCard option={selected} newsletterId={newsletterId} onBack={() => setSelected(null)} onSave={onSave} />;
	}

	const items = (kind === "offer" ? options?.offers : options?.recommendations) ?? [];
	const search = query.trim().toLowerCase();
	const shown = search ? items.filter(({ title, brand }) => `${title} ${brand}`.toLowerCase().includes(search)) : items;
	const page = KINDS.find((entry) => entry.kind === kind).page;

	return (
		<>
			<DialogHeader className="gap-1 border-b border-border/60 p-5 pb-4">
				<DialogTitle>Add from SparkLoop</DialogTitle>
				<DialogDescription>A card with its own link. SparkLoop credits each click to this issue.</DialogDescription>
				<div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
					<div className="flex w-fit items-center gap-1 rounded-xl bg-muted/70 p-1">
						{KINDS.map(({ kind: value, label, icon: Icon }) => (
							<button
								key={value}
								type="button"
								onClick={() => setKind(value)}
								aria-pressed={kind === value}
								className={cn(
									"flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors",
									kind === value ? "bg-background text-foreground shadow-border dark:bg-muted" : "text-muted-foreground hover:text-foreground"
								)}
							>
								<Icon className="size-3.5" />
								{label}
							</button>
						))}
					</div>
					<div className="relative flex-1">
						<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && shown[0]) {
									event.preventDefault();
									setSelected(shown[0]);
								}
							}}
							placeholder="Search"
							aria-label="Search"
							autoFocus
							className="h-9 pl-8"
						/>
					</div>
				</div>
			</DialogHeader>

			<div className="max-h-[min(60vh,28rem)] min-h-56 overflow-y-auto p-2">
				{!options && (
					<p className="flex h-52 items-center justify-center text-muted-foreground">
						<Loader2 className="size-5 animate-spin" />
					</p>
				)}
				{options?.error && <NoticeOptions error={options.error} />}
				{options?.ok && shown.length === 0 && (
					<div className="flex h-52 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
						<p className="max-w-xs text-pretty">
							{search
								? "Nothing matches."
								: kind === "offer"
									? "No active offers yet. Add some from SparkLoop's partner network first."
									: "No active recommendations yet. Pick newsletters to recommend first."}
						</p>
						{!search && (
							<Button asChild variant="outline" size="sm">
								<a href={page} target="_blank" rel="noopener">
									Open {kind === "offer" ? "Offers" : "Recommendations"}
									<ArrowUpRight data-icon="inline-end" className="opacity-60" />
								</a>
							</Button>
						)}
					</div>
				)}
				{options?.ok && shown.length > 0 && (
					<ul className="flex flex-col">
						{shown.map((option) => (
							<li key={option.uuid}>
								<button
									type="button"
									onClick={() => setSelected(option)}
									className="flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
								>
									<AvatarNewsletter newsletter={{ name: option.title, imageUrl: option.logo || null }} size={36} />
									<span className="min-w-0 flex-1">
										<span className="block truncate text-sm font-medium">{option.title}</span>
										<span className="block truncate text-xs text-muted-foreground">
											{option.brand || option.description}
										</span>
									</span>
									{option.payout && (
										<span
											className={cn(
												"shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
												option.payout === "Free"
													? "bg-muted text-muted-foreground"
													: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
											)}
										>
											{option.payout}
										</span>
									)}
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</>
	);
}

function NoticeOptions({ error }) {
	return (
		<div className="flex h-52 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
			<p className="max-w-xs text-pretty">{error}</p>
			<Button asChild variant="outline" size="sm">
				<a href="/sparkloop" target="_blank" rel="noopener">
					SparkLoop settings
					<ArrowUpRight data-icon="inline-end" className="opacity-60" />
				</a>
			</Button>
		</div>
	);
}

// "<" and ">" would only show as text, and the card's markup is matched by pattern: they go.
function plain(value, max) {
	return String(value ?? "")
		.replace(/[<>]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, max);
}

// The wording of a card. A new one gets its SparkLoop link on save; an edited one keeps the link it has.
function FormCard({ option, newsletterId, onBack, onSave, isEditing = false }) {
	const defaults = DEFAULT_CARD_TEXT[option.kind] ?? DEFAULT_CARD_TEXT.offer;
	const isPaid = option.paid === true || option.paid === "true";
	const sponsored = isSponsored({ kind: option.kind, paid: isPaid });
	const [fields, setFields] = useState(() => ({
		label: isEditing && !sponsored ? getCardLabel(option) : defaults.label,
		title: plain(option.title, CARD_LIMITS.title),
		description: plain(option.description, CARD_LIMITS.description),
		cta: isEditing ? plain(option.cta, CARD_LIMITS.cta) || defaults.cta : defaults.cta,
	}));
	const [isPending, startTransition] = useTransition();
	const card = useMemo(
		() => ({
			kind: option.kind,
			paid: isPaid ? "true" : "",
			image: option.image,
			logo: option.logo,
			brand: plain(option.brand, CARD_LIMITS.brand),
			label: sponsored ? SPONSORED_LABEL : plain(fields.label, CARD_LIMITS.label),
			title: plain(fields.title, CARD_LIMITS.title),
			description: plain(fields.description, CARD_LIMITS.description),
			cta: plain(fields.cta, CARD_LIMITS.cta),
		}),
		[option, fields, isPaid, sponsored]
	);

	function update(key) {
		return (event) => setFields((current) => ({ ...current, [key]: event.target.value }));
	}

	function submit(event) {
		event.preventDefault();
		if (isEditing) {
			onSave({ ...card, url: option.url });
			return;
		}
		startTransition(async () => {
			const result = await createCardLink(newsletterId, { kind: option.kind, uuid: option.uuid, title: card.title });
			if (result?.error) toast.error(result.error);
			else onSave({ ...card, url: result.url });
		});
	}

	return (
		<form onSubmit={submit}>
			<DialogHeader className="flex-row items-center gap-2 border-b border-border/60 p-3">
				{onBack && (
					<Button type="button" variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back">
						<ArrowLeft />
					</Button>
				)}
				<DialogTitle className={cn("truncate text-base", !onBack && "pl-2")}>
					{isEditing ? "Edit card" : option.title}
				</DialogTitle>
				<DialogDescription className="sr-only">Change the wording, then save the card.</DialogDescription>
			</DialogHeader>
			<div className="grid max-h-[min(70vh,34rem)] gap-5 overflow-y-auto p-5 md:grid-cols-2">
				<div className="flex flex-col gap-3">
					<Field label="Label" hint={sponsored ? "Paid placements are always labeled Sponsored." : null}>
						<Input
							value={sponsored ? SPONSORED_LABEL : fields.label}
							onChange={update("label")}
							maxLength={CARD_LIMITS.label}
							disabled={sponsored}
						/>
					</Field>
					<Field label="Headline">
						<Input value={fields.title} onChange={update("title")} maxLength={CARD_LIMITS.title} required />
					</Field>
					<Field label="Text">
						<Textarea value={fields.description} onChange={update("description")} rows={4} maxLength={CARD_LIMITS.description} />
					</Field>
					<Field label="Button">
						<Input value={fields.cta} onChange={update("cta")} maxLength={CARD_LIMITS.cta} required />
					</Field>
				</div>
				<PreviewCard card={card} />
			</div>
			<div className="flex items-center justify-between gap-3 border-t border-border/60 p-3 pl-5">
				<p className="text-xs text-pretty text-muted-foreground">
					Links carry each reader&apos;s email, filled in when they click.
				</p>
				<Button type="submit" disabled={isPending || !card.title || !card.cta} className="min-w-20 shrink-0">
					{isPending ? <Loader2 className="animate-spin" /> : isEditing ? "Save" : "Insert"}
				</Button>
			</div>
		</form>
	);
}

function Field({ label, hint, children }) {
	return (
		<label className="flex flex-col gap-1.5">
			<span className="text-xs text-muted-foreground">{label}</span>
			{children}
			{hint && <span className="text-xs text-muted-foreground">{hint}</span>}
		</label>
	);
}

// The email's card, drawn like lib/sparkloop-cards.js draws it: emails are always on white, and the
// picture keeps its own shape there.
function PreviewCard({ card }) {
	return (
		<div className="self-start overflow-hidden rounded-xl border border-zinc-200 bg-white text-zinc-700">
			{card.image && (
				<Image src={card.image} alt="" width={600} height={250} unoptimized className="block h-auto w-full" />
			)}
			<div className="p-4">
				<div className="mb-3 flex items-center gap-2.5">
					{card.logo && (
						<Image src={card.logo} alt="" width={32} height={32} unoptimized className="size-8 rounded-lg object-cover" />
					)}
					<div className="min-w-0 text-xs leading-tight">
						{card.brand && <p className="truncate font-semibold text-zinc-900">{card.brand}</p>}
						<p className="text-[10px] tracking-wider text-zinc-500 uppercase">{card.label}</p>
					</div>
				</div>
				<p className="text-[15px] leading-snug font-semibold text-zinc-950">{card.title}</p>
				{card.description && <p className="mt-1.5 line-clamp-4 text-[13px] leading-relaxed text-zinc-600">{card.description}</p>}
				<span className="mt-3 inline-block rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-white">{card.cta} →</span>
			</div>
		</div>
	);
}
