"use client";

import { useRef, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { ArrowUp, ChevronRight, Loader2, Plus, UserRound } from "lucide-react";
import DialogAddContact from "@/components/DialogAddContact";
import DialogContactsApi from "@/components/DialogContactsApi";
import DialogImportContacts from "@/components/DialogImportContacts";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FORM_SECTION, getSectionPath } from "@/lib/newsletter-sections";
import { usePaywall } from "@/lib/use-paywall";
import { cn } from "@/lib/utils";

const PAGE = "h-[4.25rem] w-[3.25rem] rounded-[5px] bg-background shadow-border";
const WINDOW = "h-[3.25rem] w-[4.75rem] rounded-[5px] bg-background shadow-border";
const LIFT = "transition-[translate] duration-200 ease-out group-hover:-translate-y-0.5";
const CHIP =
	"absolute -right-2.5 -bottom-2 grid size-5 place-items-center rounded-full bg-background text-muted-foreground shadow-border transition-[translate,rotate,color] duration-200 ease-out group-hover:text-foreground";
const CELLS = Array.from({ length: 18 }, (_, index) => index);

// Add contacts, at the top of the Contacts page: every way to add them, side by side. children: the button that opens
// it. An import, the API and by hand open their own dialog, which gives the focus back to that button; the form opens
// its settings. The import's dialog stays on the page, as a CSV dropped anywhere on it opens it too. importGuides: how to
// export a file from other platforms, for the import. curl: the newsletter's add_contact request, for the API's.
export default function DialogAddContacts({ newsletter, curl, importGuides, children }) {
	const paywall = usePaywall();
	const [isOpen, setIsOpen] = useState(false);
	const [way, setWay] = useState(null);
	const triggerRef = useRef(null);
	const isPickingRef = useRef(false);

	// Without a plan, the import opens the paywall, as the empty list's Import contacts does (GatePlan).
	function pick(name) {
		isPickingRef.current = true;
		setIsOpen(false);
		if (name === "import" && paywall && !paywall.hasPlan) paywall.open("import");
		else setWay(name);
	}

	// What was picked takes the focus this dialog would give back to its button as it closes.
	function keepFocus(event) {
		if (!isPickingRef.current) return;
		isPickingRef.current = false;
		event.preventDefault();
	}

	function returnFocus(event) {
		event.preventDefault();
		triggerRef.current?.focus();
	}

	function changeWay(name) {
		return (isWayOpen) => setWay(isWayOpen ? name : null);
	}

	return (
		<>
			<Dialog open={isOpen} onOpenChange={setIsOpen}>
				<DialogTrigger ref={triggerRef} asChild>
					{children}
				</DialogTrigger>
				<DialogContent aria-describedby={undefined} onCloseAutoFocus={keepFocus} className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Add contacts</DialogTitle>
					</DialogHeader>
					<div className="grid grid-cols-2 gap-2">
						<TileWay title="Import a CSV" description="Your list from another app" onPick={() => pick("import")}>
							<span className={cn("relative", LIFT)}>
								<span className={cn(PAGE, "grid grid-cols-3 content-start gap-x-1 gap-y-1.5 p-1.5")}>
									{CELLS.map((cell) => (
										<span key={cell} className={cn("h-1 rounded-full", cell < 3 ? "bg-foreground/25" : "bg-foreground/10")} />
									))}
								</span>
								<span className={cn(CHIP, "group-hover:-translate-y-0.5")}>
									<ArrowUp className="size-3" />
								</span>
							</span>
						</TileWay>
						<TileWay title="With the API" description="Sign people up from your code" onPick={() => pick("api")}>
							<span className={cn(WINDOW, "flex flex-col justify-center gap-1.5 px-2", LIFT)}>
								<span className="flex items-center gap-1">
									<ChevronRight className="-ml-0.5 size-2.5 text-muted-foreground" strokeWidth={3} />
									<span className="h-1 w-7 rounded-full bg-foreground/25" />
								</span>
								<span className="ml-3 h-1 w-9 rounded-full bg-foreground/10" />
								<span className="ml-3 h-1 w-6 rounded-full bg-foreground/10" />
							</span>
						</TileWay>
						<TileWay title={FORM_SECTION.label} description="Readers sign up on their own" href={getSectionPath(FORM_SECTION.id)}>
							<span className={cn(WINDOW, "flex flex-col overflow-hidden", LIFT)}>
								<span className="flex gap-0.5 border-b border-border/60 px-1.5 py-1">
									<span className="size-1 rounded-full bg-foreground/15" />
									<span className="size-1 rounded-full bg-foreground/15" />
									<span className="size-1 rounded-full bg-foreground/15" />
								</span>
								<span className="flex flex-1 flex-col items-center justify-center gap-1.5 px-2">
									<span className="h-1 w-8 rounded-full bg-foreground/25" />
									<span className="flex w-full gap-1">
										<span className="h-2.5 flex-1 rounded-[3px] shadow-border" />
										<span className="h-2.5 w-4 rounded-[3px] bg-foreground/80" />
									</span>
								</span>
							</span>
						</TileWay>
						<TileWay title="By hand" description="One person at a time" onPick={() => pick("add")}>
							<span className={cn("relative", LIFT)}>
								<span className={cn(PAGE, "flex flex-col items-center justify-center gap-1.5")}>
									<span className="mb-0.5 grid size-5 place-items-center rounded-full bg-foreground/10">
										<UserRound className="size-3 text-foreground/40" />
									</span>
									<span className="h-1 w-6 rounded-full bg-foreground/25" />
									<span className="h-1 w-8 rounded-full bg-foreground/10" />
								</span>
								<span className={cn(CHIP, "group-hover:rotate-90")}>
									<Plus className="size-3" />
								</span>
							</span>
						</TileWay>
					</div>
				</DialogContent>
			</Dialog>
			<DialogImportContacts
				newsletter={newsletter}
				guides={importGuides}
				isOpen={way === "import"}
				onOpenChange={changeWay("import")}
				onCloseAutoFocus={returnFocus}
			/>
			<DialogContactsApi newsletter={newsletter} curl={curl} isOpen={way === "api"} onOpenChange={changeWay("api")} onCloseAutoFocus={returnFocus} />
			<DialogAddContact newsletter={newsletter} isOpen={way === "add"} onOpenChange={changeWay("add")} onCloseAutoFocus={returnFocus} />
		</>
	);
}

// A way to add contacts: its picture, its name and what it's for. href: a page it opens, instead of onPick.
function TileWay({ title, description, href, onPick, children }) {
	const className =
		"group flex flex-col gap-2.5 rounded-xl p-1.5 pb-3 text-center outline-none shadow-border transition-[box-shadow,scale] duration-150 ease-out hover:shadow-border-hover focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]";
	const content = (
		<>
			<span aria-hidden="true" className="grid aspect-[16/10] place-items-center rounded-md bg-muted/60">
				{children}
			</span>
			<span className="flex flex-col gap-0.5 px-2">
				<span className="flex items-center justify-center gap-1.5 text-sm font-medium">
					{title}
					{href && <SpinnerLink />}
				</span>
				<span className="text-xs text-pretty text-muted-foreground">{description}</span>
			</span>
		</>
	);
	if (href) {
		return (
			<Link href={href} className={className}>
				{content}
			</Link>
		);
	}
	return (
		<button type="button" onClick={onPick} className={className}>
			{content}
		</button>
	);
}

// While the page a tile opens loads, as this dialog stays until it's there.
function SpinnerLink() {
	const { pending } = useLinkStatus();
	return pending ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null;
}
