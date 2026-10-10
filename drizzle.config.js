import { defineConfig } from "drizzle-kit";

// Migrations run over the direct connection: DDL doesn't belong on the pooler.
export default defineConfig({
	dialect: "postgresql",
	schema: "./lib/schema.js",
	out: "./drizzle",
	dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL },
});
