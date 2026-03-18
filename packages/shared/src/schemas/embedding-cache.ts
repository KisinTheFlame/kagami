import { z } from "zod";
import {
  createPaginatedResponseSchema,
  PaginationQuerySchema,
  parseOptionalStringInput,
} from "./base.js";

export const EmbeddingTaskTypeSchema = z.enum(["RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY"]);

export type EmbeddingTaskType = z.infer<typeof EmbeddingTaskTypeSchema>;

const parseOptionalPositiveIntInput = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : value;
};

export const EmbeddingCacheListQuerySchema = PaginationQuerySchema.extend({
  provider: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  model: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  taskType: z.preprocess(parseOptionalStringInput, EmbeddingTaskTypeSchema.optional()),
  outputDimensionality: z.preprocess(
    parseOptionalPositiveIntInput,
    z.number().int().positive().optional(),
  ),
  textHash: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  text: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  startAt: z.preprocess(parseOptionalStringInput, z.string().datetime().optional()),
  endAt: z.preprocess(parseOptionalStringInput, z.string().datetime().optional()),
}).superRefine((value, ctx) => {
  if (!value.startAt || !value.endAt) {
    return;
  }

  if (new Date(value.startAt).getTime() > new Date(value.endAt).getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["startAt"],
      message: "startAt must be less than or equal to endAt",
    });
  }
});

export type EmbeddingCacheListQuery = z.infer<typeof EmbeddingCacheListQuerySchema>;

export const EmbeddingCacheItemSchema = z
  .object({
    id: z.number().int().positive(),
    provider: z.string().min(1),
    model: z.string().min(1),
    taskType: EmbeddingTaskTypeSchema,
    outputDimensionality: z.number().int().positive(),
    text: z.string(),
    textHash: z.string().min(1),
    embeddingPreview: z.array(z.number()),
    embeddingDim: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type EmbeddingCacheItem = z.infer<typeof EmbeddingCacheItemSchema>;

export const EmbeddingCacheListResponseSchema =
  createPaginatedResponseSchema(EmbeddingCacheItemSchema);

export type EmbeddingCacheListResponse = z.infer<typeof EmbeddingCacheListResponseSchema>;
