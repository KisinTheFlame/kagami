import { z } from "zod";
import type { LlmMessage } from "../../../../llm/types.js";

export const STORY_RUNTIME_KEY = "story-agent";
export const STORY_AGENT_RUNTIME_SNAPSHOT_SCHEMA_VERSION = 1;

export const StorySchema = z.object({
  title: z.string().trim().min(1),
  time: z.string().trim(),
  scene: z.string().trim(),
  people: z.array(z.string().trim().min(1)).default([]),
  cause: z.string().trim(),
  process: z.array(z.string().trim().min(1)).default([]),
  result: z.string().trim(),
  status: z.string().trim(),
});

export type Story = z.infer<typeof StorySchema>;

export const STORY_MEMORY_DOCUMENT_KINDS = ["overview", "people_scene", "process"] as const;
export type StoryMemoryDocumentKind = (typeof STORY_MEMORY_DOCUMENT_KINDS)[number];

export type StoryRecord = {
  id: string;
  payload: Story;
  sourceMessageSeqStart: number;
  sourceMessageSeqEnd: number;
  createdAt: Date;
  updatedAt: Date;
};

export type StoryMemoryDocumentRecord = {
  id: number;
  storyId: string;
  kind: StoryMemoryDocumentKind;
  content: string;
  embeddingModel: string | null;
  embeddingDim: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StoryMemoryDocumentHit = {
  documentId: number;
  storyId: string;
  kind: StoryMemoryDocumentKind;
  content: string;
  score: number;
};

export type LinearMessageLedgerRecord = {
  seq: number;
  runtimeKey: string;
  message: LlmMessage;
  createdAt: Date;
};

export type LinearMessageLedgerInsert = Omit<LinearMessageLedgerRecord, "seq" | "createdAt"> & {
  createdAt?: Date;
};

export type StoryAgentRuntimeSnapshot = {
  runtimeKey: string;
  schemaVersion: number;
  contextSnapshot: import("../../../runtime/root-agent/persistence/root-agent-runtime-snapshot.js").PersistedAgentContextSnapshot;
  lastProcessedMessageSeq: number;
};

export function normalizeEmbedding(embedding: number[]): number[] {
  const sumSquares = embedding.reduce((sum, value) => sum + value * value, 0);
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) {
    return embedding;
  }

  return embedding.map(value => value / norm);
}
