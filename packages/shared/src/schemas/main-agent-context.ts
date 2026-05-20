import { z } from "zod";

export const MainAgentContextItemKindSchema = z.enum(["llm_message", "event"]);

export type MainAgentContextItemKind = z.infer<typeof MainAgentContextItemKindSchema>;

export const MainAgentContextItemSchema = z
  .object({
    kind: MainAgentContextItemKindSchema,
    label: z.string().min(1),
    preview: z.string(),
    truncated: z.boolean(),
  })
  .strict();

export type MainAgentContextItem = z.infer<typeof MainAgentContextItemSchema>;

export const MainAgentContextSnapshotSchema = z
  .object({
    generatedAt: z.string().datetime(),
    recentItems: z.array(MainAgentContextItemSchema),
    recentItemsTruncated: z.boolean(),
  })
  .strict();

export type MainAgentContextSnapshot = z.infer<typeof MainAgentContextSnapshotSchema>;
