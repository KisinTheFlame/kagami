export type LlmCallStatus = "success" | "fail";

type LlmCallLogData = {
    readonly timestamp: Date,
    readonly status: LlmCallStatus,
    readonly input: string,
    readonly output: string,
};

export type LlmCallLog = LlmCallLogData & {
    readonly id: number,
};

export type LlmCallLogCreateRequest = LlmCallLogData;
