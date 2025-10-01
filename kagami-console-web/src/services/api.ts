import axios from "axios";
import type { LogQueryParams, LogQueryResponse, LLMCallLog } from "../types/api";

const API_BASE_URL = "/kagami/api/v1";

const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 10000,
});

export const llmLogsApi = {
    // 获取 LLM 日志列表
    getLogs: (params: LogQueryParams): Promise<LogQueryResponse> => {
        return api.get("/llm-logs", { params }).then(res => res.data as LogQueryResponse);
    },

    // 获取单个 LLM 日志详情
    getLog: (id: number): Promise<LLMCallLog> => {
        return api.get(`/llm-logs/${String(id)}`).then(res => res.data as LLMCallLog);
    },
};
