// LLM 调用状态
export type LlmCallStatus = "success" | "fail";

// LLM 调用日志数据（内部使用原生 Date 类型）
type LlmCallLogData = {
    readonly timestamp: Date,
    readonly status: LlmCallStatus,
    readonly input: string,
    readonly output: string,
};

// 完整的 LLM 调用日志（包含 ID）
export type LlmCallLog = LlmCallLogData & {
    readonly id: number,
};

// 创建 LLM 调用日志的请求（不包含 ID）
export type LlmCallLogCreateRequest = LlmCallLogData;
