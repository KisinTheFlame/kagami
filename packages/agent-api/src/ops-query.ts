import { z } from "zod";
import { JsonRecordSchema } from "@kagami/http/wire";

/**
 * console 只读查询的 wire schema（epic #539 子 issue 4：console 脱库，agent 持有的
 * app_log / inner_thought / todo_item 经本契约查询）。
 *
 * 形状与 @kagami/console-api 的对应 response item 逐字段逐约束对齐（ISO 字符串时间），
 * 让 console 侧成为纯转发聚合层：DB Date → ISO 的序列化与 legacy 值归一（如 todo 的
 * repeatEveryMs<=0 归 null）都归 agent handler。服务间 POST JSON，page/pageSize 是真数字，
 * 上限与 console-api（@kagami/http/wire PaginationQuerySchema）的 100 对齐。
 */

const QueryPaginationSchema = {
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
};

// —— app_log ——

export const AgentAppLogLevelSchema = z.enum(["debug", "info", "warn", "error", "fatal"]);

export const AgentQueryAppLogsRequestSchema = z.object({
  level: AgentAppLogLevelSchema.optional(),
  traceId: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  ...QueryPaginationSchema,
});

export type AgentQueryAppLogsRequest = z.infer<typeof AgentQueryAppLogsRequestSchema>;

export const AgentAppLogWireItemSchema = z.object({
  id: z.number().int().positive(),
  traceId: z.string().min(1),
  level: AgentAppLogLevelSchema,
  message: z.string().min(1),
  metadata: JsonRecordSchema,
  createdAt: z.string().datetime(),
});

export type AgentAppLogWireItem = z.infer<typeof AgentAppLogWireItemSchema>;

export const AgentQueryAppLogsResponseSchema = z.object({
  total: z.number().int().min(0),
  items: z.array(AgentAppLogWireItemSchema),
});

export type AgentQueryAppLogsResponse = z.infer<typeof AgentQueryAppLogsResponseSchema>;

// —— inner_thought ——

export const AgentInnerThoughtOutcomeSchema = z.enum(["injected", "empty", "failed"]);

export const AgentQueryInnerThoughtsRequestSchema = z.object({
  outcome: AgentInnerThoughtOutcomeSchema.optional(),
  ...QueryPaginationSchema,
});

export type AgentQueryInnerThoughtsRequest = z.infer<typeof AgentQueryInnerThoughtsRequestSchema>;

export const AgentInnerThoughtWireItemSchema = z.object({
  id: z.number().int().positive(),
  triggeredAt: z.string().datetime(),
  outcome: AgentInnerThoughtOutcomeSchema,
  thought: z.string(),
  runtimeKey: z.string(),
  createdAt: z.string().datetime(),
});

export type AgentInnerThoughtWireItem = z.infer<typeof AgentInnerThoughtWireItemSchema>;

export const AgentQueryInnerThoughtsResponseSchema = z.object({
  total: z.number().int().min(0),
  items: z.array(AgentInnerThoughtWireItemSchema),
});

export type AgentQueryInnerThoughtsResponse = z.infer<typeof AgentQueryInnerThoughtsResponseSchema>;

// —— todo_item ——

export const AgentTodoStatusSchema = z.enum(["pending", "completed", "removed"]);

export const AgentQueryTodosRequestSchema = z.object({
  status: AgentTodoStatusSchema.optional(),
  ...QueryPaginationSchema,
});

export type AgentQueryTodosRequest = z.infer<typeof AgentQueryTodosRequestSchema>;

export const AgentTodoWireItemSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  note: z.string().nullable(),
  status: AgentTodoStatusSchema,
  remindAt: z.string().datetime().nullable(),
  repeatEveryMs: z.number().int().positive().nullable(),
  snoozedUntil: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export type AgentTodoWireItem = z.infer<typeof AgentTodoWireItemSchema>;

export const AgentQueryTodosResponseSchema = z.object({
  total: z.number().int().min(0),
  items: z.array(AgentTodoWireItemSchema),
});

export type AgentQueryTodosResponse = z.infer<typeof AgentQueryTodosResponseSchema>;
