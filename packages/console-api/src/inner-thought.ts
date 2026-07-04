import { z } from "zod";
import {
  createPaginatedResponseSchema,
  PaginationQuerySchema,
  parseOptionalStringInput,
} from "@kagami/http/wire";

export const InnerThoughtOutcomeSchema = z.enum(["injected", "empty", "failed"]);

export type InnerThoughtOutcome = z.infer<typeof InnerThoughtOutcomeSchema>;

export const InnerThoughtListQuerySchema = PaginationQuerySchema.extend({
  outcome: z.preprocess(parseOptionalStringInput, InnerThoughtOutcomeSchema.optional()),
});

export type InnerThoughtListQuery = z.infer<typeof InnerThoughtListQuerySchema>;

export const InnerThoughtItemSchema = z.object({
  id: z.number().int().positive(),
  triggeredAt: z.string().datetime(),
  outcome: InnerThoughtOutcomeSchema,
  thought: z.string(),
  runtimeKey: z.string(),
  createdAt: z.string().datetime(),
});

export type InnerThoughtItem = z.infer<typeof InnerThoughtItemSchema>;

export const InnerThoughtListResponseSchema = createPaginatedResponseSchema(InnerThoughtItemSchema);

export type InnerThoughtListResponse = z.infer<typeof InnerThoughtListResponseSchema>;
