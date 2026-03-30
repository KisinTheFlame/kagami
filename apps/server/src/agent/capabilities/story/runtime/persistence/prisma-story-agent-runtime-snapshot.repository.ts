import type * as Prisma from "../../../../../generated/prisma/internal/prismaNamespace.js";
import type { Database } from "../../../../../db/client.js";
import {
  PersistedStoryAgentRuntimeSnapshotSchema,
  type PersistedStoryAgentRuntimeSnapshot,
} from "./story-agent-runtime-snapshot.js";
import type { StoryAgentRuntimeSnapshotRepository } from "./story-agent-runtime-snapshot.repository.js";

export class PrismaStoryAgentRuntimeSnapshotRepository implements StoryAgentRuntimeSnapshotRepository {
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  public async load(runtimeKey: string): Promise<PersistedStoryAgentRuntimeSnapshot | null> {
    const row = await this.database.storyAgentRuntimeSnapshot.findUnique({
      where: {
        runtimeKey,
      },
    });
    if (!row) {
      return null;
    }

    const parsed = PersistedStoryAgentRuntimeSnapshotSchema.safeParse({
      runtimeKey: row.runtimeKey,
      schemaVersion: row.schemaVersion,
      contextSnapshot: row.contextSnapshot,
      lastProcessedMessageSeq: row.lastProcessedMessageSeq,
    });

    if (!parsed.success) {
      return null;
    }

    return parsed.data;
  }

  public async save(snapshot: PersistedStoryAgentRuntimeSnapshot): Promise<void> {
    await this.database.storyAgentRuntimeSnapshot.upsert({
      where: {
        runtimeKey: snapshot.runtimeKey,
      },
      create: {
        runtimeKey: snapshot.runtimeKey,
        schemaVersion: snapshot.schemaVersion,
        contextSnapshot: toInputJsonObject(snapshot.contextSnapshot),
        lastProcessedMessageSeq: snapshot.lastProcessedMessageSeq,
      },
      update: {
        schemaVersion: snapshot.schemaVersion,
        contextSnapshot: toInputJsonObject(snapshot.contextSnapshot),
        lastProcessedMessageSeq: snapshot.lastProcessedMessageSeq,
        updatedAt: new Date(),
      },
    });
  }

  public async delete(runtimeKey: string): Promise<void> {
    await this.database.storyAgentRuntimeSnapshot.deleteMany({
      where: {
        runtimeKey,
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
