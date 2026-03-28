import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

export type Database = PrismaClient;

export function createDbClient({ databaseUrl }: { databaseUrl: string }): Database {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

export async function closeDb(database: Database): Promise<void> {
  await database.$disconnect();
}
