"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Lock } from "lucide-react";
import { getFieldPath, getSectionPath } from "@/lib/newsletter-sections";
import { getNewsletterPagePath } from "@/lib/newsletters";
import { getFooterReason } from "@/lib/render-email";
import { useHasRole } from "@/lib/use-team-role";
import { cn } from "@/lib/utils";

// The footer every email ends with (lib/render-email.js), under the issue in the campaign editor, where it can't be
// removed. The newsletter's admins edit its name and postal address in its settings, in a new tab: coming back to the
// editor brings the page up to date, its checks included. Settings pages are the admins' only.
export default function FooterEmail({ newsletter }) {
	const router = useRouter();
	const canEdit = useHasRole("admin");
	const [hasOpenedSettings, setHasOpenedSettings] = useState(false);
	const address = newsletter.postalAddress?.trim();

	useEffect(() => {
		if (!hasOpenedSettings) return;
		const refresh = () => router.refresh();
		window.addEventListener("focus", refresh);
		return () => window.removeEventListener("focus", refresh);
	}, [hasOpenedSettings, router]);

	const openSettings = () => setHasOpenedSettings(true);

	return (
		<footer className="px-5 pb-6 text-xs leading-relaxed text-muted-foreground [@media(pointer:fine)]:pl-12">
			<div className="border-t border-border pt-5">
				<p>
					{getFooterReason(newsletter.name)} <span className="underline underline-offset-2">Unsubscribe</span>
				</p>
				{address && <p>{address}</p>}
			</div>
			<div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
				<span className="flex items-center gap-1.5">
					<Lock aria-hidden="true" className="size-3" />
					Added to every email
				</span>
				{canEdit && (
					<span className="flex flex-wrap items-center gap-x-4 gap-y-2">
						<LinkSettings href={getNewsletterPagePath(newsletter._id, getSectionPath("general"))} onClick={openSettings}>
							Edit name
						</LinkSettings>
						<LinkSettings href={getFieldPath("postal-address")} onClick={openSettings} isWarning={!address}>
							{address ? "Edit address" : "Add a postal address"}
						</LinkSettings>
					</span>
				)}
			</div>
		</footer>
	);
}

// Sending waits for a postal address (lib/presend-checks.js), so adding one stands out.
function LinkSettings({ href, onClick, isWarning = false, children }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener"
			onClick={onClick}
			className={cn(
				"relative inline-flex items-center gap-1 font-medium transition-colors duration-150 after:absolute after:-inset-x-2 after:-inset-y-2",
				isWarning ? "text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300" : "hover:text-foreground"
			)}
		>
			{children}
			<ArrowUpRight aria-hidden="true" className="size-3" />
		</a>
	);
}
