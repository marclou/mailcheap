import { and, asc, desc, eq, notExists, sql } from "drizzle-orm";
import { AUDIENCE_SORT, normalizeLimit } from "./audience.js";
import { contacts, suppressions } from "./schema.js";

const COLUMNS = {
	lastClickAt: contacts.lastClickAt,
	lastOpenAt: contacts.lastOpenAt,
	"imported.clickRate": contacts.importedClickRate,
	"imported.openRate": contacts.importedOpenRate,
	createdAt: contacts.createdAt,
	_id: contacts._id,
};

// Active contacts whose address isn't suppressed, in AUDIENCE_SORT order. Missing values sort last when
// descending, as they did in MongoDB.
export function buildAudienceQuery({ newsletterId, audienceLimit }) {
	const where = and(
		eq(contacts.newsletterId, newsletterId),
		eq(contacts.status, "active"),
		notExists(sql`(select 1 from ${suppressions} where ${suppressions.email} = ${contacts.email})`)
	);
	const orderBy = Object.entries(AUDIENCE_SORT).map(([path, direction]) =>
		direction < 0 ? sql`${desc(COLUMNS[path])} nulls last` : asc(COLUMNS[path])
	);
	return { where, orderBy, limit: normalizeLimit(audienceLimit) };
}
