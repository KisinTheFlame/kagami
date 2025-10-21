import { z } from "zod";

// API 查询参数 Schema 和类型
export const llmLogQueryParamsSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(["success", "fail"]).optional(),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    orderBy: z.enum(["timestamp", "status", "id"]).default("timestamp"),
    orderDirection: z.enum(["asc", "desc"]).default("desc"),
});

export type LlmLogQueryParams = z.infer<typeof llmLogQueryParamsSchema>;

// LLM 调用日志 DTO（用于 API 传输）
export type LlmCallLogDTO = {
    readonly id: number,
    readonly timestamp: string, // ISO 8601 字符串格式
    readonly status: "success" | "fail",
    readonly input: string,
    readonly output: string,
};

// API 响应类型
export type LlmLogListResponse = {
    data: LlmCallLogDTO[],
    total: number,
    page: number,
    limit: number,
};

export type ErrorResponse = {
    error: string,
};
