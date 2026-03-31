import { z } from "zod";
import {
  createPaginatedResponseSchema,
  PaginationQuerySchema,
  parseOptionalStringInput,
} from "./base.js";

export const StoryMatchedKindSchema = z.enum(["overview", "people_scene", "process"]);

export type StoryMatchedKind = z.infer<typeof StoryMatchedKindSchema>;

export const StoryListQuerySchema = PaginationQuerySchema.extend({
  query: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
});

export type StoryListQuery = z.infer<typeof StoryListQuerySchema>;

export const StoryItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    time: z.string(),
    scene: z.string(),
    people: z.array(z.string()),
    cause: z.string(),
    process: z.array(z.string()),
    result: z.string(),
    status: z.string(),
    sourceMessageSeqStart: z.number().int().nonnegative(),
    sourceMessageSeqEnd: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    score: z.number().nullable(),
    matchedKinds: z.array(StoryMatchedKindSchema),
  })
  .strict();

export type StoryItem = z.infer<typeof StoryItemSchema>;

export const StoryListResponseSchema = createPaginatedResponseSchema(StoryItemSchema);

export type StoryListResponse = z.infer<typeof StoryListResponseSchema>;
