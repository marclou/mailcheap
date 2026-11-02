"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { checkWebsiteDomain, removeWebsiteDomain, setWebsiteDomain } from "@/app/(app)/newsletters/actions";
import ImageFavicon from "@/components/ImageFavicon";
import LinkHelp from "@/components/LinkHelp";
import ListDnsSteps from "@/components/ListDnsSteps";
import TextStatus from "@/components/TextStatus";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
import { usePaywall } from "@/lib/use-paywall";

// Where the Website page's other cards send people to add or finish the domain (components/FormNewsletter.jsx).
export const OWN_DOMAIN_ID = "own-domain";

// The newsletter's own domain for its website, inside the Website settings form: its field and buttons act on their
// own and never send the form. setup: lib/website-domain-rules.js getWebsiteDomainSetup, null without a domain.
// sharedAddress: where the website goes back to without one.
export default function CardWebsiteDomain({ newsletterId, setup, sharedAddress, stagger }) {
	const paywall = usePaywall();
	const [hostInput, setHostInput] = useState("");
	const [isPending, startPending] = useTransition();

	function add() {
		if (paywall && !paywall.hasPlan) return paywall.open("websiteDomain");
		const host = hostInput.trim();
		if (!host) return;
		startPending(async () => {
			const result = await setWebsiteDomain(newsletterId, host);
			if (result?.error) return void toast.error(result.error);
			setHostInput("");
			if (result.live) toast.success("Your website is live on your domain");
			else toast.message("Add the DNS records below, then check.");
		});
	}

	function check() {
		if (paywall && !paywall.hasPlan) return paywall.open("websiteDomain");
		startPending(async () => {
			const result = await checkWebsiteDomain(newsletterId);
			if (result?.error) return void toast.error(result.error);
			if (result.live && result.pointed) toast.success(`${setup.host} is live`);
			else if (result.live) toast.error(`${setup.host} doesn't point at MailCheap anymore. Add its CNAME record back.`);
			else toast.message("Some records aren't there yet. DNS changes can take up to a few hours.");
		});
	}

	if (!setup) {
		return (
			<section id={OWN_DOMAIN_ID} style={{ "--stagger": stagger }} className="scroll-mt-24 rounded-xl bg-card shadow-border animate-enter">
				<h2 className="flex h-12 items-center px-4 text-sm font-medium">Your own domain</h2>
				<div className="flex flex-col gap-3 border-t border-border/60 px-4 py-3">
					<p className="text-sm text-pretty text-muted-foreground">
						Put your website and the links in your emails on a subdomain of yours, like news.example.com.{" "}
						<LinkHelp article="website" section="own-domain" />
					</p>
					<div className="flex flex-col gap-2 sm:flex-row">
						<Input
							value={hostInput}
							aria-label="Subdomain for your website"
							placeholder="news.yourdomain.com"
							inputMode="url"
							autoComplete="off"
							autoCapitalize="none"
							spellCheck={false}
							className="font-mono sm:flex-1"
							onChange={(event) => setHostInput(event.target.value)}
							onKeyDown={(event) => {
								if (event.key !== "Enter") return;
								event.preventDefault();
								add();
							}}
						/>
						<Button type="button" onClick={add} disabled={isPending} className="sm:min-w-32">
							{isPending ? <Loader2 className="animate-spin" /> : <Plus data-icon="inline-start" />}
							Add domain
						</Button>
					</div>
				</div>
			</section>
		);
	}

	return (
		<section
			id={OWN_DOMAIN_ID}
			style={{ "--stagger": stagger }}
			className="scroll-mt-24 overflow-hidden rounded-xl bg-card shadow-border animate-enter"
		>
			<div className="flex flex-wrap items-center justify-between gap-3 p-4">
				<div className="flex min-w-0 items-center gap-3">
					<div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
						<ImageFavicon domain={setup.zone} size={20} />
					</div>
					<div className="min-w-0">
						<p className="truncate font-medium">{setup.host}</p>
						<TextStatus {...setup.status} className="text-xs" />
					</div>
				</div>
				<div className="flex items-center gap-1">
					<Button type="button" variant="outline" size="sm" onClick={check} disabled={isPending}>
						{isPending ? <Loader2 className="animate-spin" /> : <RefreshCw data-icon="inline-start" />}
						Check now
					</Button>
					<DialogRemove newsletterId={newsletterId} host={setup.host} isLive={setup.isLive} sharedAddress={sharedAddress} />
				</div>
			</div>
			{!setup.isLive && (
				<p className="border-t border-border/60 bg-muted/40 px-4 py-3 text-sm text-pretty text-muted-foreground">
					Add these records where your domain&apos;s DNS is managed, then check. DNS changes can take up to a few hours.{" "}
					<LinkHelp article="website" section="own-domain" />
				</p>
			)}
			<ListDnsSteps steps={setup.steps} />
		</section>
	);
}

function DialogRemove({ newsletterId, host, isLive, sharedAddress }) {
	const [isOpen, setIsOpen] = useState(false);
	const [isRemoving, startRemoving] = useTransition();

	function remove() {
		startRemoving(async () => {
			const result = await removeWebsiteDomain(newsletterId);
			if (result?.error) return void toast.error(result.error);
			setIsOpen(false);
			toast.success(`${host} removed`);
		});
	}

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogTrigger asChild>
				<Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${host}`} className="text-muted-foreground hover:text-foreground">
					<Trash2 />
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Remove {host}?</DialogTitle>
					<DialogDescription>
						{isLive
							? `Your website and the links in your next emails go back to ${sharedAddress}. Links in emails you already sent keep working while ${host} points at MailCheap.`
							: "You can add it again later."}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose asChild>
						<Button type="button" variant="outline">
							Cancel
						</Button>
					</DialogClose>
					<Button type="button" variant="destructive" onClick={remove} disabled={isRemoving} className="min-w-20">
						{isRemoving ? <Loader2 className="animate-spin" /> : "Remove"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
