import { z } from "zod";

export const JsonRecordSchema = z.record(z.string(), z.unknown());

const parseNumberInput = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : value;
};

export const parseOptionalStringInput = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

export const PaginationQuerySchema = z.object({
  page: z.preprocess(parseNumberInput, z.number().int().positive()).default(1),
  pageSize: z.preprocess(parseNumberInput, z.number().int().positive().max(100)).default(20),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export const PaginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(100),
  total: z.number().int().nonnegative(),
});

export type Pagination = z.infer<typeof PaginationSchema>;

export function createPaginatedResponseSchema<ItemSchema extends z.ZodTypeAny>(
  itemSchema: ItemSchema,
) {
  return z.object({
    pagination: PaginationSchema,
    items: z.array(itemSchema),
  });
}
