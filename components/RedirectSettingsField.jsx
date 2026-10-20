"use client";

import { useEffect } from "react";
import { getFieldPath } from "@/lib/newsletter-sections";

// Links into the one-page settings that came before end with a field's #, which only the browser sees: its section's
// page opens instead, at the field.
export default function RedirectSettingsField() {
	useEffect(() => {
		const path = getFieldPath(decodeURIComponent(window.location.hash.slice(1)));
		if (path) window.location.replace(path);
	}, []);

	return null;
}
