import {
  getPrismaClientClass,
  type PrismaClient as PrismaClientInstance,
} from "../generated/prisma/internal/class.js";
import { PrismaPg } from "@prisma/adapter-pg";

const PrismaClient = getPrismaClientClass();

export type Database = PrismaClientInstance;

export function createDbClient({ databaseUrl }: { databaseUrl: string }): Database {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

export async function closeDb(database: Database): Promise<void> {
  await database.$disconnect();
}
