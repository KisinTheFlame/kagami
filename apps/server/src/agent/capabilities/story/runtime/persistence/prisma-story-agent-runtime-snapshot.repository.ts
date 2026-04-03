import { toInputJsonObject } from "../../../../../common/prisma-json.js";
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
