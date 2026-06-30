import type { Database } from "@kagami/persistence/db/client";
import type {
  TerminalOutputDao,
  TerminalOutputRecord,
} from "../application/terminal-output.dao.js";

export class PrismaTerminalOutputDao implements TerminalOutputDao {
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  public async save(input: { outputId: string; stdout: string; stderr: string }): Promise<void> {
    await this.database.terminalOutput.create({
      data: {
        outputId: input.outputId,
        stdout: input.stdout,
        stderr: input.stderr,
      },
    });
  }

  public async findByOutputId(input: { outputId: string }): Promise<TerminalOutputRecord | null> {
    const row = await this.database.terminalOutput.findUnique({
      where: {
        outputId: input.outputId,
      },
    });
    if (!row) {
      return null;
    }
    return {
      outputId: row.outputId,
      stdout: row.stdout,
      stderr: row.stderr,
      createdAt: row.createdAt,
    };
  }
}
