import { z } from "zod";
import {
  createPaginatedResponseSchema,
  JsonRecordSchema,
  PaginationQuerySchema,
  parseOptionalStringInput,
} from "./base.js";

export const AppLogLevelSchema = z.enum(["debug", "info", "warn", "error", "fatal"]);

export type AppLogLevel = z.infer<typeof AppLogLevelSchema>;

export const AppLogListQuerySchema = PaginationQuerySchema.extend({
  level: z.preprocess(parseOptionalStringInput, AppLogLevelSchema.optional()),
  traceId: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  message: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  source: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
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

export type AppLogListQuery = z.infer<typeof AppLogListQuerySchema>;

export const AppLogItemSchema = z.object({
  id: z.number().int().positive(),
  traceId: z.string().min(1),
  level: AppLogLevelSchema,
  message: z.string().min(1),
  metadata: JsonRecordSchema,
  createdAt: z.string().datetime(),
});

export type AppLogItem = z.infer<typeof AppLogItemSchema>;

export const AppLogListResponseSchema = createPaginatedResponseSchema(AppLogItemSchema);

export type AppLogListResponse = z.infer<typeof AppLogListResponseSchema>;
