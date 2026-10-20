"use client";

import { useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { exportContacts } from "@/app/(app)/contacts/actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

// The file downloads from a link valid for an hour, with the list's current filters.
export default function ButtonExportContacts({ newsletterId, status, query, segmentId, tag, isDisabled }) {
	const [isPending, startTransition] = useTransition();

	function download() {
		startTransition(async () => {
			const result = await exportContacts({ newsletterId, status, query, segmentId, tag });
			if (result?.error) return void toast.error(result.error);
			window.location.assign(result.url);
		});
	}

	return (
		<Button variant="outline" onClick={download} disabled={isPending || isDisabled}>
			{isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Download data-icon="inline-start" />}
			Export
		</Button>
	);
}
