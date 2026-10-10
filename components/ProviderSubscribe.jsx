"use client";

import { createContext, use, useEffect, useMemo, useState } from "react";
import PitchSubscribe from "@/components/PitchSubscribe";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { storeValue, subscribeSnoozedKey } from "@/lib/storage";

const SubscribeContext = createContext(null);

export function useSubscribe() {
	return use(SubscribeContext);
}

export default function ProviderSubscribe({ newsletter, readers, children }) {
	const [openedBy, setOpenedBy] = useState(null);
	const value = useMemo(() => ({ open: (source = "reader") => setOpenedBy(source) }), []);

	function onOpenChange(open) {
		if (open) return;
		setOpenedBy(null);
		storeValue(subscribeSnoozedKey(newsletter.slug), Date.now());
	}

	// SparkLoop's signup flow takes over after a signup; the popup is modal, so it would block the flow.
	useEffect(() => {
		const close = () => setOpenedBy(null);
		document.addEventListener("sl:signup-flow-opened", close);
		return () => document.removeEventListener("sl:signup-flow-opened", close);
	}, []);

	// A popup that appears mid-read shouldn't throw the phone keyboard over the issue.
	function onOpenAutoFocus(event) {
		if (openedBy === "scroll" && window.matchMedia("(pointer: coarse)").matches) event.preventDefault();
	}

	return (
		<SubscribeContext value={value}>
			{children}
			<Dialog open={Boolean(openedBy)} onOpenChange={onOpenChange}>
				<DialogContent
					aria-describedby={undefined}
					onOpenAutoFocus={onOpenAutoFocus}
					className="p-8 pt-10 sm:max-w-md"
				>
					<PitchSubscribe newsletter={newsletter} readers={readers} titleAs={DialogTitle} />
				</DialogContent>
			</Dialog>
		</SubscribeContext>
	);
}
