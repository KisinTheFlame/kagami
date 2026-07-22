import { z } from "zod";
import { JsonRecordSchema, JsonValueSchema } from "@kagami/http/wire";

/**
 * console 只读查询的 wire schema（epic #539 子 issue 2：console 脱库，napcat 数据经本契约查询）。
 *
 * 形状与 @kagami/console-api 的对应 response item 逐字段对齐（ISO 字符串时间、payload 为
 * JSON record），让 console 侧成为纯转发聚合层：DB Date → ISO 的序列化归 napcat handler。
 * 与 console-api 的 query schema 不同，这里是服务间 POST JSON，page/pageSize 是真数字，
 * 不需要 querystring 的 preprocess 强转。
 */

const QueryPaginationSchema = {
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(200),
};

const QueryTimeRangeSchema = {
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
};

export const NapcatQueryEventsRequestSchema = z.object({
  postType: z.string().min(1).optional(),
  messageType: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  ...QueryTimeRangeSchema,
  ...QueryPaginationSchema,
});

export type NapcatQueryEventsRequest = z.infer<typeof NapcatQueryEventsRequestSchema>;

export const NapcatEventWireItemSchema = z.object({
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

export type NapcatEventWireItem = z.infer<typeof NapcatEventWireItemSchema>;

export const NapcatQueryEventsResponseSchema = z.object({
  total: z.number().int().min(0),
  items: z.array(NapcatEventWireItemSchema),
});

export type NapcatQueryEventsResponse = z.infer<typeof NapcatQueryEventsResponseSchema>;

export const NapcatQqMessageWireTypeSchema = z.enum(["group", "private"]);

export const NapcatQueryQqMessagesRequestSchema = z.object({
  messageType: NapcatQqMessageWireTypeSchema.optional(),
  groupId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  nickname: z.string().min(1).optional(),
  keyword: z.string().min(1).optional(),
  ...QueryTimeRangeSchema,
  ...QueryPaginationSchema,
});

export type NapcatQueryQqMessagesRequest = z.infer<typeof NapcatQueryQqMessagesRequestSchema>;

export const NapcatQqMessageWireItemSchema = z.object({
  id: z.number().int().positive(),
  messageType: NapcatQqMessageWireTypeSchema,
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

export type NapcatQqMessageWireItem = z.infer<typeof NapcatQqMessageWireItemSchema>;

export const NapcatQueryQqMessagesResponseSchema = z.object({
  total: z.number().int().min(0),
  items: z.array(NapcatQqMessageWireItemSchema),
});

export type NapcatQueryQqMessagesResponse = z.infer<typeof NapcatQueryQqMessagesResponseSchema>;
