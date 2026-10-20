// Vercel BotID's answer in tests: a person, unless a test says otherwise with setBotIdVerdict ("bot", or "error" for a
// check that fails). Every check is recorded in botIdChecks.
let verdict = "human";
export const botIdChecks = [];

export function setBotIdVerdict(next) {
	verdict = next;
}

export async function checkBotId() {
	botIdChecks.push(verdict);
	if (verdict === "error") throw new Error("BotID is unreachable");
	const isBot = verdict === "bot";
	return { isHuman: !isBot, isBot, isVerifiedBot: false, bypassed: false };
}
