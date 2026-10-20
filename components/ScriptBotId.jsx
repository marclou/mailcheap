"use client";

import { useEffect } from "react";
import { initBotId } from "botid/client/core";

// Each start wraps fetch once more, so a set of paths starts once per page load, however often its page renders.
const started = new Set();

// Vercel BotID in the browser (lib/bot-check.js): a form sent to one of these paths carries its proof that a browser
// sent it. Started from an effect, so a page reached by a link has it too; its script loads when such a form is sent.
export default function ScriptBotId({ protect }) {
	useEffect(() => {
		const key = JSON.stringify(protect);
		if (started.has(key)) return;
		started.add(key);
		initBotId({ protect });
	}, [protect]);

	return null;
}
