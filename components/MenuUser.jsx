"use client";

import { useTransition } from "react";
import Link from "next/link";
import { ChevronsUpDown, CircleHelp, CreditCard, LogOut, Moon, Sun, UserRound } from "lucide-react";
import { signOut } from "@/app/signin/actions";
import AvatarUser from "@/components/AvatarUser";
import { RadioGroupTheme } from "@/components/ButtonThemeToggle";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuPortal,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { askToSignOut } from "@/lib/sign-out";
import { cn } from "@/lib/utils";

// The bottom of the sidebar and of the mobile menu: who's signed in and whether the account sends, with what
// concerns the whole account rather than one newsletter. status: getSendingStatus (lib/account-state.js).
export default function MenuUser({ name, email, image, status, hasBilling }) {
	const [isSigningOut, startSigningOut] = useTransition();
	const displayName = name?.trim() || email;

	function signOutAfterAsking() {
		if (askToSignOut()) startSigningOut(() => signOut());
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left outline-none transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-muted"
				>
					<AvatarUser name={name} email={email} image={image} size={32} />
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="truncate text-sm leading-5 font-medium">{displayName}</span>
						<span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
							<span className={cn("size-1.5 shrink-0 rounded-full", TONES[status.tone])} />
							<span className="truncate">{status.label}</span>
						</span>
					</span>
					<ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent side="top" align="start" sideOffset={6} className="min-w-56">
				<DropdownMenuLabel className="flex flex-col gap-0.5 px-2 py-1.5 font-normal">
					{name?.trim() && <span className="truncate text-sm font-medium text-foreground">{name}</span>}
					<span className="truncate text-xs text-muted-foreground">{email}</span>
					{status.hint && <span className="mt-1 text-xs text-pretty text-muted-foreground">{status.hint}</span>}
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link href="/account">
						<UserRound />
						Account
					</Link>
				</DropdownMenuItem>
				{hasBilling && (
					<DropdownMenuItem asChild>
						<Link href="/billing">
							<CreditCard />
							Billing
						</Link>
					</DropdownMenuItem>
				)}
				<DropdownMenuItem asChild>
					<a href="/help" target="_blank" rel="noopener">
						<CircleHelp />
						Help
					</a>
				</DropdownMenuItem>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						<Sun className="dark:hidden" />
						<Moon className="hidden dark:block" />
						Theme
					</DropdownMenuSubTrigger>
					<DropdownMenuPortal>
						<DropdownMenuSubContent className="w-36">
							<RadioGroupTheme />
						</DropdownMenuSubContent>
					</DropdownMenuPortal>
				</DropdownMenuSub>
				<DropdownMenuSeparator />
				<DropdownMenuItem disabled={isSigningOut} onSelect={signOutAfterAsking}>
					<LogOut />
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

const TONES = {
	green: "bg-emerald-500",
	amber: "bg-amber-500",
	red: "bg-red-500",
	gray: "bg-muted-foreground/50",
};
