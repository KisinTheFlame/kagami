// API 类型定义

export interface LLMCallLog {
    id: number;
    timestamp: string;
    status: "success" | "fail";
    input: string;
    output: string;
}

export interface LogQueryParams {
    page?: number;
    limit?: number;
    status?: "success" | "fail";
    startTime?: string;
    endTime?: string;
    orderBy?: "timestamp" | "status" | "id";
    orderDirection?: "asc" | "desc";
}

export interface LogQueryResponse {
    data: LLMCallLog[];
    total: number;
    page: number;
    limit: number;
}
