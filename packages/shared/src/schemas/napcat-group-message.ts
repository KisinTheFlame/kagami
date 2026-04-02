import { z } from "zod";
import {
  createPaginatedResponseSchema,
  JsonRecordSchema,
  JsonValueSchema,
  PaginationQuerySchema,
  parseOptionalStringInput,
} from "./base.js";

export const NapcatQqMessageTypeSchema = z.enum(["group", "private"]);

export type NapcatQqMessageType = z.infer<typeof NapcatQqMessageTypeSchema>;

export const NapcatQqMessageListQuerySchema = PaginationQuerySchema.extend({
  messageType: z.preprocess(parseOptionalStringInput, NapcatQqMessageTypeSchema.optional()),
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

export type NapcatQqMessageListQuery = z.infer<typeof NapcatQqMessageListQuerySchema>;

export const NapcatQqMessageItemSchema = z.object({
  id: z.number().int().positive(),
  messageType: NapcatQqMessageTypeSchema,
  subType: z.string().min(1),
  groupId: z.string().min(1).nullable(),
  userId: z.string().min(1).nullable(),
  nickname: z.string().min(1).nullable(),
  messageId: z.number().int().positive().nullable(),
  message: JsonValueSchema,
  eventTime: z.string().datetime().nullable(),
  payload: JsonRecordSchema,
  createdAt: z.string().datetime(),
});

export type NapcatQqMessageItem = z.infer<typeof NapcatQqMessageItemSchema>;

export const NapcatQqMessageListResponseSchema =
  createPaginatedResponseSchema(NapcatQqMessageItemSchema);

export type NapcatQqMessageListResponse = z.infer<typeof NapcatQqMessageListResponseSchema>;
