import { Client } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

// One direct connection: migrations run statements in order, so a pool would only hold connections open.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (run: neon env pull)");

const client = new Client(url);
await client.connect();
try {
	await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
	console.log("Migrations applied");
} finally {
	await client.end();
}
