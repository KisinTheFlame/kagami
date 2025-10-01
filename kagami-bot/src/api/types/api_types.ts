import { z } from "zod";
import { LlmCallLog } from "../../domain/llm_call_log.js";

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

export type LlmLogListResponse = {
    data: LlmCallLog[],
    total: number,
    page: number,
    limit: number,
};

export type ErrorResponse = {
    error: string,
};
