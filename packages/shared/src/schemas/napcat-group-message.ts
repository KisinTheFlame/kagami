import { z } from "zod";
import {
  createPaginatedResponseSchema,
  JsonRecordSchema,
  PaginationQuerySchema,
  parseOptionalStringInput,
} from "./base.js";

export const NapcatGroupMessageListQuerySchema = PaginationQuerySchema.extend({
  groupId: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  userId: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  nickname: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  keyword: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
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

export type NapcatGroupMessageListQuery = z.infer<typeof NapcatGroupMessageListQuerySchema>;

export const NapcatGroupMessageItemSchema = z.object({
  id: z.number().int().positive(),
  groupId: z.string().min(1),
  userId: z.string().min(1).nullable(),
  nickname: z.string().min(1).nullable(),
  messageId: z.number().int().positive().nullable(),
  rawMessage: z.string().min(1),
  eventTime: z.string().datetime().nullable(),
  payload: JsonRecordSchema,
  createdAt: z.string().datetime(),
});

export type NapcatGroupMessageItem = z.infer<typeof NapcatGroupMessageItemSchema>;

export const NapcatGroupMessageListResponseSchema = createPaginatedResponseSchema(
  NapcatGroupMessageItemSchema,
);

export type NapcatGroupMessageListResponse = z.infer<typeof NapcatGroupMessageListResponseSchema>;
