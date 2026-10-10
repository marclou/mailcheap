import { sql } from "drizzle-orm";
import { contacts } from "./schema.js";

// MongoDB's $max: a date column only ever moves forward. GREATEST skips NULLs, so an empty column takes `at`.
export function laterOf(column, at) {
	return sql`greatest(${column}, ${at})`;
}

// Any sign of life starts the list cleanup's count over (lib/cleanup.js).
export function withEngagement(set = {}, at = new Date()) {
	return { ...set, ignoredIssues: 0, lastEngagedAt: laterOf(contacts.lastEngagedAt, at) };
}
