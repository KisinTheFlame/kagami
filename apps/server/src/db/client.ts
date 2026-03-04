import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env.js";

const queryClient = postgres(env.DATABASE_URL);

export const db = drizzle(queryClient);
export type Database = typeof db;

export async function closeDb(): Promise<void> {
  await queryClient.end();
}
