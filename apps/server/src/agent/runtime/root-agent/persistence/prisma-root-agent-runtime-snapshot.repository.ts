import type { Prisma } from "../../../../generated/prisma/client.js";
import type { Database } from "../../../../db/client.js";
import { AppLogger } from "../../../../logger/logger.js";
import type { RootAgentRuntimeSnapshotRepository } from "./root-agent-runtime-snapshot.repository.js";
import {
  PersistedRootAgentRuntimeSnapshotSchema,
  type PersistedRootAgentRuntimeSnapshot,
} from "./root-agent-runtime-snapshot.js";

const logger = new AppLogger({ source: "agent.root-agent-runtime-snapshot-repository" });

export class PrismaRootAgentRuntimeSnapshotRepository implements RootAgentRuntimeSnapshotRepository {
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  public async load(runtimeKey: string): Promise<PersistedRootAgentRuntimeSnapshot | null> {
    const row = await this.database.rootAgentRuntimeSnapshot.findUnique({
      where: {
        runtimeKey,
      },
    });

    if (!row) {
      return null;
    }

    const parsed = PersistedRootAgentRuntimeSnapshotSchema.safeParse({
      runtimeKey: row.runtimeKey,
      schemaVersion: row.schemaVersion,
      contextSnapshot: row.contextSnapshot,
      sessionSnapshot: row.sessionSnapshot,
      lastWakeReminderAt: row.lastWakeReminderAt,
    });

    if (!parsed.success) {
      logger.warn("Discarding invalid root agent runtime snapshot", {
        event: "agent.root_agent_runtime_snapshot.invalid",
        runtimeKey,
        issues: parsed.error.issues,
      });
      return null;
    }

    return parsed.data;
  }

  public async save(snapshot: PersistedRootAgentRuntimeSnapshot): Promise<void> {
    await this.database.rootAgentRuntimeSnapshot.upsert({
      where: {
        runtimeKey: snapshot.runtimeKey,
      },
      create: {
        runtimeKey: snapshot.runtimeKey,
        schemaVersion: snapshot.schemaVersion,
        contextSnapshot: toInputJsonObject(snapshot.contextSnapshot),
        sessionSnapshot: toInputJsonObject(snapshot.sessionSnapshot),
        lastWakeReminderAt: snapshot.lastWakeReminderAt,
      },
      update: {
        schemaVersion: snapshot.schemaVersion,
        contextSnapshot: toInputJsonObject(snapshot.contextSnapshot),
        sessionSnapshot: toInputJsonObject(snapshot.sessionSnapshot),
        lastWakeReminderAt: snapshot.lastWakeReminderAt,
      },
    });
  }
}

function toInputJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  const normalized = normalizeInputJsonValue(value);
  if (typeof normalized === "object" && normalized !== null && !Array.isArray(normalized)) {
    return normalized as Prisma.InputJsonObject;
  }

  return {
    value: normalized,
  };
}

function normalizeInputJsonValue(value: unknown): Prisma.InputJsonValue {
  try {
    const serialized = JSON.stringify(value, (_key, currentValue) => {
      if (currentValue instanceof Date) {
        return currentValue.toISOString();
      }
      if (typeof currentValue === "bigint") {
        return currentValue.toString();
      }
      if (typeof currentValue === "function" || typeof currentValue === "symbol") {
        return String(currentValue);
      }

      return currentValue;
    });

    if (serialized === undefined) {
      return "undefined";
    }

    const parsed = JSON.parse(serialized) as unknown;
    if (parsed === null) {
      return "null";
    }

    return parsed as Prisma.InputJsonValue;
  } catch {
    if (value instanceof Error) {
      return value.message;
    }

    return String(value);
  }
}
