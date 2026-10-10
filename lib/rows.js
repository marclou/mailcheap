import { sql } from "drizzle-orm";
import { campaigns, contacts } from "./schema.js";

// Rows come back flat, with null for every empty column. The app reads records the way MongoDB returned
// them: unset fields missing, and counters grouped (campaign.stats.sent, contact.imported.openRate).
const CAMPAIGN_GROUPS = {
	stats: ["recipients", "sent", "delivered", "bounced", "complained", "opened", "clicked", "unsubscribed", "failed"],
	lastChance: ["recipients", "sent", "delivered", "bounced", "complained", "failed", "dormant"],
};
const CONTACT_GROUPS = {
	stats: ["sent", "opens", "clicks"],
	imported: ["emailsReceived", "openRate", "clickRate"],
};

function columnKey(group, key) {
	return `${group}${key[0].toUpperCase()}${key.slice(1)}`;
}

function nest(row, groups) {
	if (!row) return null;
	const record = {};
	const grouped = new Map();
	for (const [group, keys] of Object.entries(groups)) {
		for (const key of keys) grouped.set(columnKey(group, key), [group, key]);
	}
	for (const [column, value] of Object.entries(row)) {
		if (value === null || value === undefined) continue;
		const target = grouped.get(column);
		if (!target) {
			record[column] = value;
			continue;
		}
		const [group, key] = target;
		record[group] ??= {};
		record[group][key] = value;
	}
	return record;
}

// Selected rows with only some columns stay partial, like a MongoDB projection.
export function toRecord(row) {
	if (!row) return null;
	return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null && value !== undefined));
}

export function toCampaign(row) {
	return nest(row, CAMPAIGN_GROUPS);
}

export function toContact(row) {
	return nest(row, CONTACT_GROUPS);
}

// "stats.sent" -> campaigns.statsSent
export function campaignColumn(path) {
	const [group, key] = path.split(".");
	const column = campaigns[columnKey(group, key)];
	if (!column) throw new Error(`Unknown campaign counter ${path}`);
	return column;
}

export function contactColumn(path) {
	const [group, key] = path.split(".");
	const column = contacts[columnKey(group, key)];
	if (!column) throw new Error(`Unknown contact counter ${path}`);
	return column;
}

// MongoDB's $inc for an update's set: { "stats.sent": 1 } -> { statsSent: sql`stats_sent + 1` }
export function increments(table, columnFor, inc) {
	return Object.fromEntries(
		Object.entries(inc).map(([path, amount]) => {
			const column = columnFor(path);
			const name = Object.keys(table).find((key) => table[key] === column);
			return [name, sql`${column} + ${amount}`];
		})
	);
}

export function campaignIncrements(inc) {
	return increments(campaigns, campaignColumn, inc);
}

export function contactIncrements(inc) {
	return increments(contacts, contactColumn, inc);
}
