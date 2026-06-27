import type { AppStateStore, JsonValue } from "@kagami/agent-runtime";
import { normalizeInputJsonValue } from "@kagami/server-core/common/prisma-json";
import type { Database } from "@kagami/server-core/db/client";

/**
 * App 状态持久化能力的 SQLite 实现：一张 `app_state` 表服务所有 App，按 appId 存取一份
 * 不透明 JSON。状态的形状 + 版本由各 App 自己拥有，这里只做 KV 式存取（upsert / 读）。
 */
export class PrismaAppStateStore implements AppStateStore {
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  public async load(appId: string): Promise<JsonValue | null> {
    const row = await this.database.appState.findUnique({ where: { appId } });
    if (!row) {
      return null;
    }
    return row.state as JsonValue;
  }

  public async save(appId: string, state: JsonValue): Promise<void> {
    const value = normalizeInputJsonValue(state);
    await this.database.appState.upsert({
      where: { appId },
      create: { appId, state: value },
      update: { state: value },
    });
  }
}
