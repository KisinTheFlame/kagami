import prismaClientPkg, { type PrismaClient as PrismaClientType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const { PrismaClient } = prismaClientPkg;

export type Database = PrismaClientType;

export function createDbClient({ databaseUrl }: { databaseUrl: string }): Database {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

export async function closeDb(database: Database): Promise<void> {
  await database.$disconnect();
}
