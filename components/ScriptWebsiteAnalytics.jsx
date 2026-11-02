"use client";

import { useEffect } from "react";
import { startWebsiteAnalytics } from "@/lib/website-analytics";

let isStarted = false;

// The newsletter's analytics tools on its website (lib/website-analytics.js), started once per page load: a link to
// another of its pages keeps them running, and Google Analytics and the Meta pixel count it as a page view on their own.
export default function ScriptWebsiteAnalytics({ analytics }) {
	useEffect(() => {
		if (isStarted) return;
		isStarted = true;
		startWebsiteAnalytics(analytics);
	}, [analytics]);

	return null;
}
