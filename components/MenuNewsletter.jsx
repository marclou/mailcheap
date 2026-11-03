"use client";

import { useLayoutEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronsUpDown, Loader2, Plus, Settings } from "lucide-react";
import { selectNewsletter } from "@/app/(app)/newsletters/actions";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ADD_NEWSLETTER_PARAM, MAX_NEWSLETTERS_PER_ACCOUNT, NEWSLETTER_COOKIE, NEWSLETTER_LIMIT_MESSAGE } from "@/lib/newsletters";
import { readCookie } from "@/lib/storage";
import { ROLE_LABELS } from "@/lib/team-rules";
import { toast } from "@/lib/toast";
import { useHasRole } from "@/lib/use-team-role";
import { cn } from "@/lib/utils";

// The sidebar and the phone's top bar each have this menu: one refresh does for both.
let refreshedFor = null;

// The newsletter the dashboard shows, and the others to switch to. savedId: the cookie the layout was rendered from.
// addForm: FormAddNewsletter, for Add a newsletter's dialog.
export default function MenuNewsletter({ newsletters, selectedId, savedId, isCompact = false, addForm }) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [isPending, startTransition] = useTransition();
	const [shownId, setShownId] = useState(selectedId);
	const [renderedId, setRenderedId] = useState(selectedId);
	const [isAdding, setIsAdding] = useState(false);
	const hasSettings = useHasRole("admin");
	if (selectedId !== renderedId) {
		setRenderedId(selectedId);
		setShownId(selectedId);
		setIsAdding(false);
	}
	const shown = newsletters.find(({ id }) => id === shownId) ?? newsletters[0];
	// Links to Add a newsletter open the sidebar's dialog: that menu is on the page at every width, only hidden on
	// phones, and the dialog shows over the page from a portal.
	const isLinked = !isCompact && searchParams.has(ADD_NEWSLETTER_PARAM);

	// Pages follow the cookie, and this layout doesn't render again on navigation: a link to another newsletter's
	// campaign, or a switch in another tab, changes the cookie under it. The menu then shows the newsletter the page
	// shows before it paints, and refreshes once to catch up.
	useLayoutEffect(() => {
		function check() {
			const cookie = readCookie(NEWSLETTER_COOKIE);
			if (!cookie || cookie === savedId) return;
			if (newsletters.some(({ id }) => id === cookie)) setShownId(cookie);
			const key = `${savedId}>${cookie}`;
			if (refreshedFor === key) return;
			refreshedFor = key;
			router.refresh();
		}
		check();
		window.addEventListener("focus", check);
		return () => window.removeEventListener("focus", check);
	}, [pathname, savedId, newsletters, router]);

	function setAdding(isOpen) {
		setIsAdding(isOpen);
		if (isOpen || !isLinked) return;
		const params = new URLSearchParams(searchParams);
		params.delete(ADD_NEWSLETTER_PARAM);
		const query = params.toString();
		window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
	}

	const dialog = (
		<Dialog open={isAdding || isLinked} onOpenChange={setAdding}>
			<DialogContent className="sm:max-w-md">{addForm}</DialogContent>
		</Dialog>
	);

	if (!shown) {
		return (
			<>
				<button type="button" onClick={() => setAdding(true)} className={cn(TRIGGER, isCompact ? TRIGGER_COMPACT : TRIGGER_FULL, "text-muted-foreground")}>
					<span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted">
						<Plus className="size-3.5" />
					</span>
					<span className="truncate text-sm font-medium sidebar-label">Add a newsletter</span>
				</button>
				{dialog}
			</>
		);
	}

	function select(id) {
		if (id === shownId) return;
		setShownId(id);
		startTransition(async () => {
			const result = await selectNewsletter(id, pathname);
			if (!result?.error) return;
			setShownId(selectedId);
			toast.error(result.error);
		});
	}

	const own = newsletters.filter(({ role }) => !role);
	const shared = newsletters.filter(({ role }) => role);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button type="button" aria-label={`Newsletter: ${shown.name}`} className={cn(TRIGGER, isCompact ? TRIGGER_COMPACT : TRIGGER_FULL)}>
						<AvatarNewsletter newsletter={shown} size={24} />
						<span className="min-w-0 flex-1 truncate text-left text-sm font-medium sidebar-label">{shown.name}</span>
						<span className="relative grid size-4 shrink-0 place-items-center text-muted-foreground sidebar-label">
							<ChevronsUpDown className={cn("absolute size-4", ICON_MOTION, isPending ? ICON_HIDDEN : ICON_SHOWN)} />
							<Loader2 className={cn("absolute size-4 animate-spin", ICON_MOTION, isPending ? ICON_SHOWN : ICON_HIDDEN)} />
						</span>
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" sideOffset={6} className={cn("p-1.5", isCompact ? "w-64" : "min-w-60")}>
					{own.length > 0 && (
						<>
							<DropdownMenuLabel className="px-2 pt-1 pb-1.5">Newsletters</DropdownMenuLabel>
							<DropdownMenuRadioGroup value={shownId} onValueChange={select}>
								{own.map((newsletter) => (
									<ItemNewsletter key={newsletter.id} newsletter={newsletter} />
								))}
							</DropdownMenuRadioGroup>
						</>
					)}
					{shared.length > 0 && (
						<>
							{own.length > 0 && <DropdownMenuSeparator className="my-1.5" />}
							<DropdownMenuLabel className="px-2 pt-1 pb-1.5">Shared with you</DropdownMenuLabel>
							<DropdownMenuRadioGroup value={shownId} onValueChange={select}>
								{shared.map((newsletter) => (
									<ItemNewsletter key={newsletter.id} newsletter={newsletter} />
								))}
							</DropdownMenuRadioGroup>
						</>
					)}
					<DropdownMenuSeparator className="my-1.5" />
					{own.length < MAX_NEWSLETTERS_PER_ACCOUNT ? (
						<DropdownMenuItem className={ITEM} onSelect={() => setAdding(true)}>
							<Plus />
							Add a newsletter
						</DropdownMenuItem>
					) : (
						<div className="px-2 py-1.5">
							<DropdownMenuItem disabled className="h-auto gap-2.5 p-0 text-muted-foreground">
								<Plus />
								Add a newsletter
							</DropdownMenuItem>
							<p className="mt-1 text-xs text-pretty text-muted-foreground">{NEWSLETTER_LIMIT_MESSAGE}</p>
						</div>
					)}
					{hasSettings && (
						<DropdownMenuItem asChild className={ITEM}>
							<Link href="/newsletters">
								<Settings />
								Newsletter settings
							</Link>
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			{dialog}
		</>
	);
}

// A shared newsletter shows the user's role on it.
function ItemNewsletter({ newsletter }) {
	return (
		<DropdownMenuRadioItem value={newsletter.id} className="h-9 gap-2.5 rounded-lg pl-2">
			<AvatarNewsletter newsletter={newsletter} size={20} />
			<span className="truncate">{newsletter.name}</span>
			{newsletter.role && <span className="ml-auto shrink-0 pr-5 text-xs text-muted-foreground">{ROLE_LABELS[newsletter.role]}</span>}
		</DropdownMenuRadioItem>
	);
}

const TRIGGER =
	"flex min-w-0 items-center gap-2.5 outline-none transition-[background-color,box-shadow] duration-150 focus-visible:ring-3 focus-visible:ring-ring/50";
// The folded sidebar only shows the avatar, where it was: the rest is cut at the edge as it fades.
const TRIGGER_FULL =
	"h-11 w-full overflow-hidden rounded-xl bg-card pr-3 pl-2.5 shadow-border hover:bg-muted/50 hover:shadow-border-hover data-[state=open]:bg-muted/60";
const TRIGGER_COMPACT = "h-10 max-w-full rounded-lg pr-2 pl-1.5 hover:bg-muted data-[state=open]:bg-muted";
const ITEM = "h-9 gap-2.5 rounded-lg px-2 text-muted-foreground focus:text-foreground [&_svg]:text-muted-foreground";
// Both icons stay in place, so the spinner and the chevrons cross-fade instead of jumping.
const ICON_MOTION = "transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)]";
const ICON_SHOWN = "scale-100 opacity-100 blur-[0px]";
const ICON_HIDDEN = "scale-25 opacity-0 blur-[4px]";
