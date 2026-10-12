import { getConfigProblems } from "./lib/config.js";

// Runs once when a server starts, before it takes requests. Builds skip it, so they need no secrets.
export function register() {
	const problems = getConfigProblems();
	if (problems.length > 0) throw new Error(`Mailcheap can't start. ${problems.join(" ")}`);

	// The local job queue replaces QStash on servers that run all the time (Docker, Coolify, a VPS).
	// Not awaited, so a bad config still throws synchronously above.
	if (process.env.NEXT_RUNTIME === "nodejs" && process.env.JOB_QUEUE === "local") {
		import("./lib/job-ticker.js").then(({ startJobTicker }) => startJobTicker());
	}
}
