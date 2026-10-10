import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

// The HTTP driver holds no connection: each query is one HTTPS round trip to Lakebase Postgres, which suits
// serverless requests on Vercel and the sender function alike.
let instance;

export function getDb() {
	if (instance) return instance;
	if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
	instance = drizzle({ client: neon(process.env.DATABASE_URL), schema });
	return instance;
}

// Postgres unique_violation, the counterpart of MongoDB's duplicate key error 11000.
export function isUniqueViolation(error) {
	return (error?.code ?? error?.cause?.code) === "23505";
}
