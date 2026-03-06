import prismaClientPkg from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../env.js";

const { PrismaClient } = prismaClientPkg;
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const db = new PrismaClient({ adapter });
export type Database = typeof db;

export async function closeDb(): Promise<void> {
  await db.$disconnect();
}
