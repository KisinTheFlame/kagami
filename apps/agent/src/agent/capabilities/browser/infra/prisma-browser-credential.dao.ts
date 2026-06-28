import type { Database } from "@kagami/server-core/db/client";
import type {
  BrowserCredential,
  BrowserCredentialDao,
} from "../application/browser-credential.dao.js";

export class PrismaBrowserCredentialDao implements BrowserCredentialDao {
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  public async get(handle: string): Promise<BrowserCredential | null> {
    const row = await this.database.browserCredential.findUnique({
      where: { handle },
    });
    if (!row) {
      return null;
    }
    return { handle: row.handle, username: row.username, secret: row.secret };
  }

  public async put(credential: BrowserCredential): Promise<void> {
    await this.database.browserCredential.upsert({
      where: { handle: credential.handle },
      create: {
        handle: credential.handle,
        username: credential.username,
        secret: credential.secret,
      },
      update: { username: credential.username, secret: credential.secret },
    });
  }

  public async listHandles(): Promise<string[]> {
    const rows = await this.database.browserCredential.findMany({
      select: { handle: true },
      orderBy: { handle: "asc" },
    });
    return rows.map(row => row.handle);
  }
}
