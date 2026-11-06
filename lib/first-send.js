import { FIRST_SEND } from "./config.js";
import { formatRate, getRateName, judgeRates } from "./rate-levels.js";

// How many never-mailed contacts each step sends, the rest last: [200, 467, 8668] for 9,335 of them. A step is its share
// of them within its bounds, and only when more than it remain. null when they all go at once.
export function getFirstSendSteps(neverMailed) {
	const sizes = [];
	let left = neverMailed;
	for (const { share, min, max } of FIRST_SEND.steps) {
		const size = Math.min(max, Math.max(min, Math.round(neverMailed * share)));
		if (left <= size) break;
		sizes.push(size);
		left -= size;
	}
	return sizes.length > 0 ? [...sizes, left] : null;
}

// The new contacts' rates over their sent emails, at a campaign's levels (lib/rate-levels.js): { level, metric, reason }
// or null. block: the account is blocked with reason. pause: the rest of the campaign waits for its owner.
export function getFirstSendProblem({ sent = 0, bounced = 0, complained = 0, refused = 0 }) {
	const judged = judgeRates({ sent, bounced, complained, refused });
	if (!judged) return null;
	const rate = `${getRateName(judged.metric)} of ${formatRate(judged.rate)} (limit ${formatRate(judged.limit)})`;
	return { level: judged.level, metric: judged.metric, reason: `The first ${sent} new contacts had a ${rate}` };
}
