import axios from "axios";
import type { LlmLogQueryParams, LlmLogListResponse, LlmCallLogDTO } from "kagami-types/dto/llm_call_log";

const API_BASE_URL = "/kagami/api/v1";

const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 10000,
});

export const llmLogsApi = {
    // 获取 LLM 日志列表
    getLogs: (params: LlmLogQueryParams): Promise<LlmLogListResponse> => {
        return api.get("/llm-logs", { params }).then(res => res.data as LlmLogListResponse);
    },

    // 获取单个 LLM 日志详情
    getLog: (id: number): Promise<LlmCallLogDTO> => {
        return api.get(`/llm-logs/${String(id)}`).then(res => res.data as LlmCallLogDTO);
    },
};
