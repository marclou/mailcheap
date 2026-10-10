import { sql } from "drizzle-orm";
import { messages } from "./schema.js";

// Messages that reached each step: count() of a column counts the rows where it's set.
export const MESSAGE_STATS_COLUMNS = {
	sent: sql`count(${messages.sentAt})`.mapWith(Number),
	delivered: sql`count(${messages.deliveredAt})`.mapWith(Number),
	opened: sql`count(${messages.openedAt})`.mapWith(Number),
	clicked: sql`count(${messages.clickedAt})`.mapWith(Number),
	bounced: sql`count(${messages.bouncedAt})`.mapWith(Number),
	complained: sql`count(${messages.complainedAt})`.mapWith(Number),
};
