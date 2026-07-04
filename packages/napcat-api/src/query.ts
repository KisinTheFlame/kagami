import { z } from "zod";
import {
  createPaginatedResponseSchema,
  JsonRecordSchema,
  JsonValueSchema,
  PaginationQuerySchema,
  parseOptionalStringInput,
} from "@kagami/http/wire";

/**
 * console / 管理台对 napcat 的**只读查询** wire（A2，issue #347）—— 忠实镜像原
 * `@kagami/console-api` 的 napcat-event / napcat-group-message schema。拆分后 napcat 服务 own
 * `napcat_event` / `napcat_qq_message` 两张表，console 改经这两条路由的 HTTP client 查询、不再直读
 * 共享 DB。schema 与形状保持一致，让 #350 console 侧从直读 DAO 切成 HTTP client 是 drop-in。
 *
 * `message` 字段沿用 `JsonValueSchema`（opaque）—— console 前端只展示、不走 typed 段。
 */

// —— napcat_event 查询 ——
export const NapcatEventListQuerySchema = PaginationQuerySchema.extend({
  postType: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  messageType: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  userId: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
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

export type NapcatEventListQuery = z.infer<typeof NapcatEventListQuerySchema>;

export const NapcatEventItemSchema = z.object({
  id: z.number().int().positive(),
  postType: z.string().min(1),
  messageType: z.string().nullable(),
  subType: z.string().nullable(),
  userId: z.string().nullable(),
  groupId: z.string().nullable(),
  eventTime: z.string().datetime().nullable(),
  payload: JsonRecordSchema,
  createdAt: z.string().datetime(),
});

export type NapcatEventItem = z.infer<typeof NapcatEventItemSchema>;

export const NapcatEventListResponseSchema = createPaginatedResponseSchema(NapcatEventItemSchema);

export type NapcatEventListResponse = z.infer<typeof NapcatEventListResponseSchema>;

// —— napcat_qq_message 查询 ——
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
