"use client";

import { useEffect } from "react";
import { WEBSITE_CODE_PATH, insertWebsiteCode, parseWebsiteCode } from "@/lib/website-code";

let isStarted = false;

// The newsletter's own code (lib/website-code.js), asked for once per page load and only on its own domain: the same
// cached page is served on its address on the shared domain too, where the code must never run.
export default function ScriptWebsiteCode({ ownDomain }) {
	useEffect(() => {
		if (isStarted || window.location.hostname !== ownDomain) return;
		isStarted = true;
		fetch(WEBSITE_CODE_PATH, { credentials: "omit" })
			.then((response) => (response.status === 200 ? response.json() : null))
			.then((body) => body?.code && insertWebsiteCode(parseWebsiteCode(body.code)))
			.catch((error) => console.error("[website-code]", error));
	}, [ownDomain]);

	return null;
}
