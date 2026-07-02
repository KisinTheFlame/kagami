import { z } from "zod";

// === wire 基元：跨服务 HTTP 契约共用的 JSON / 分页 / 探活形状 ===
//
// 本模块必须保持浏览器安全：只依赖 zod，绝不 import fastify 或任何 Node API。
// web 前端与各 *-api 契约包都从这里取基元；服务端注册原语在 contract.ts / route.ts。

export const JsonRecordSchema = z.record(z.string(), z.unknown());

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = {
  [key: string]: JsonValue;
};
export type JsonArray = JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([JsonPrimitiveSchema, z.record(z.string(), JsonValueSchema), z.array(JsonValueSchema)]),
);

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

export const HealthQuerySchema = z.object({}).passthrough();

export type HealthQuery = z.infer<typeof HealthQuerySchema>;

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export function createHealthResponse(): HealthResponse {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
  };
}
