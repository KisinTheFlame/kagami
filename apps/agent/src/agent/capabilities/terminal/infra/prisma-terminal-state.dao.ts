import type { Database } from "@kagami/persistence/db/client";
import type { TerminalStateDao } from "../application/terminal-state.dao.js";

export class PrismaTerminalStateDao implements TerminalStateDao {
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  private static readonly SINGLETON_ID = 1;

  public async loadCwd(): Promise<string | null> {
    const row = await this.database.terminalState.findUnique({
      where: { id: PrismaTerminalStateDao.SINGLETON_ID },
    });
    return row?.cwd ?? null;
  }

  public async saveCwd(input: { cwd: string }): Promise<void> {
    await this.database.terminalState.upsert({
      where: { id: PrismaTerminalStateDao.SINGLETON_ID },
      create: { id: PrismaTerminalStateDao.SINGLETON_ID, cwd: input.cwd },
      update: { cwd: input.cwd },
    });
  }
}
