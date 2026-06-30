import type { AppStateStore, JsonValue } from "@kagami/agent-runtime";
import { normalizeInputJsonValue } from "@kagami/persistence/common/prisma-json";
import type { Database } from "@kagami/persistence/db/client";
import { AppLogger } from "@kagami/kernel/logger/logger";

const logger = new AppLogger({ source: "agent.app-state-store" });

/**
 * 判定一个未知值是否是合法 JsonValue（递归）。Prisma 的 Json 列读出来是 unknown，
 * 这里只做"结构合法性"校验——内容形状/版本仍由各 App 的 restoreState 自己拥有。
 */
function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) {
    return true;
  }
  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (valueType === "object") {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }
  return false;
}

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
    // fail-soft：坏的持久化数据不应让启动或主流程崩溃。结构不合法时记 warn 并按
    // "无状态"处理（返回 null），各 App 的 restoreState 会走首次初始化路径。
    if (!isJsonValue(row.state)) {
      logger.warn("Discarding invalid persisted app state", {
        event: "agent.app_state.invalid",
        appId,
      });
      return null;
    }
    return row.state;
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
