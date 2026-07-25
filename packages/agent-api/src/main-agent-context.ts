import { z } from "zod";

export const MainAgentContextItemKindSchema = z.enum(["llm_message", "event"]);

export type MainAgentContextItemKind = z.infer<typeof MainAgentContextItemKindSchema>;

export const MainAgentContextItemSchema = z
  .object({
    kind: MainAgentContextItemKindSchema,
    label: z.string().min(1),
    preview: z.string(),
    truncated: z.boolean(),
  })
  .strict();

export type MainAgentContextItem = z.infer<typeof MainAgentContextItemSchema>;

export const MainAgentContextSnapshotSchema = z
  .object({
    generatedAt: z.string().datetime(),
    recentItems: z.array(MainAgentContextItemSchema),
    recentItemsTruncated: z.boolean(),
  })
  .strict();

export type MainAgentContextSnapshot = z.infer<typeof MainAgentContextSnapshotSchema>;

/**
 * 压缩比例的合法区间（整数百分比，语义 = 摘要掉前百分之多少）。
 * 下限 10：更低的比例省不下多少 token，却要白烧一次 summarizer 调用。
 * 上限 100 = 全部摘要、一条不留。前端输入框校验与服务端 schema 共用这两个常量。
 */
export const MAIN_AGENT_CONTEXT_COMPRESS_RATIO_MIN = 10;
export const MAIN_AGENT_CONTEXT_COMPRESS_RATIO_MAX = 100;

export const MainAgentContextCompactionRequestSchema = z
  .object({
    compressRatio: z
      .number()
      .int()
      .min(MAIN_AGENT_CONTEXT_COMPRESS_RATIO_MIN)
      .max(MAIN_AGENT_CONTEXT_COMPRESS_RATIO_MAX),
  })
  .strict();

export type MainAgentContextCompactionRequest = z.infer<
  typeof MainAgentContextCompactionRequestSchema
>;

export const MainAgentContextCompactionResultSchema = z
  .object({
    // 是否实际执行了压缩；上下文为空、按该比例算下来无可摘要、或摘要失败时为 false。
    compacted: z.boolean(),
    compactedAt: z.string().datetime(),
    // 本次实际摘要掉的消息条数。切点会向后扩到 tool-call 边界，所以可能多于名义比例。
    summarizedCount: z.number().int().nonnegative(),
    // 压缩后留在尾部的消息条数；compacted=false 时为当前上下文的全部条数（一条没动）。
    keptCount: z.number().int().nonnegative(),
    // 实际生效的比例。并发压缩去重时会复用先到那次的请求值，与本次入参可能不同。
    appliedCompressRatio: z.number().int(),
  })
  .strict();

export type MainAgentContextCompactionResult = z.infer<
  typeof MainAgentContextCompactionResultSchema
>;
