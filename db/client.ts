import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Lazy Drizzle client.
 *
 * Why lazy: Next.js evaluates route handler modules during `next build`
 * ("Collecting page data" phase) on platforms like Vercel, where
 * runtime-only env vars (DATABASE_URL) aren't injected. A top-level throw
 * here would fail every production build that imports this module. The
 * proxy below delays the throw + the connection until the first method
 * call, which only happens at request time.
 *
 * The exported `db` keeps the same shape as before, so all existing
 * consumers (`db.select(...)`, `db.insert(...)`, transactions, etc.) work
 * unchanged.
 */

type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>;

let cached: DrizzleClient | null = null;

function getClient(): DrizzleClient {
  if (cached) return cached;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const sql = postgres(connectionString, { prepare: false });
  cached = drizzle(sql, { schema });
  return cached;
}

export const db = new Proxy({} as DrizzleClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export { schema };
