"use client";

import { useMemo, useState } from "react";
import SliderPricing from "@/components/SliderPricing";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PaywallContext } from "@/lib/use-paywall";

// The dashboard opens without a plan. What costs something (sending, imports, domains, API keys) opens this
// instead, with the plans as the pricing page shows them. pricing: lib/pricing.js, on the plan the list fits.
export default function ProviderPaywall({ hasPlan, pricing, children }) {
	const [state, setState] = useState({ isOpen: false, reason: "default" });
	const value = useMemo(() => ({ hasPlan, open: (reason = "default") => setState({ isOpen: true, reason }) }), [hasPlan]);

	return (
		<PaywallContext value={value}>
			{children}
			{!hasPlan && (
				<Dialog open={state.isOpen} onOpenChange={(isOpen) => setState((current) => ({ ...current, isOpen }))}>
					<DialogContent className="max-h-[calc(100dvh-2rem)] gap-6 overflow-y-auto p-5 sm:max-w-4xl sm:p-8">
						<DialogHeader className="gap-1.5 pr-8">
							<DialogTitle className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">
								{TITLES[state.reason] ?? TITLES.default}
							</DialogTitle>
							<DialogDescription className="text-[15px] text-pretty">
								Every plan has every feature. Your newsletter and drafts are saved.
							</DialogDescription>
						</DialogHeader>
						<SliderPricing {...pricing} />
					</DialogContent>
				</Dialog>
			)}
		</PaywallContext>
	);
}

const TITLES = {
	default: "Pick a plan to start sending",
	send: "Pick a plan to send your campaign",
	schedule: "Pick a plan to schedule your campaign",
	test: "Pick a plan to send test emails",
	import: "Pick a plan to add subscribers",
	contact: "Pick a plan to add more contacts",
	domain: "Pick a plan to send from your own domain",
	apiKey: "Pick a plan to use the API",
	upload: "Pick a plan to upload more images",
	website: "Pick a plan to put your website online",
	websiteDomain: "Pick a plan to put your website on your own domain",
	team: "Pick a plan to invite your team",
};
