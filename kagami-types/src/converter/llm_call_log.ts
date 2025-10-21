import type { LlmCallLog } from "../domain/llm_call_log.js";
import type { LlmCallLogDTO } from "../dto/llm_call_log.js";

/**
 * 将领域模型转换为 API DTO
 * @param log 领域模型（使用 Date）
 * @returns API DTO（使用 ISO 8601 字符串）
 */
export function llmCallLogToDTO(log: LlmCallLog): LlmCallLogDTO {
    return {
        id: log.id,
        timestamp: log.timestamp.toISOString(),
        status: log.status,
        input: log.input,
        output: log.output,
    };
}

/**
 * 将 API DTO 转换为领域模型
 * @param dto API DTO（使用 ISO 8601 字符串）
 * @returns 领域模型（使用 Date）
 */
export function llmCallLogFromDTO(dto: LlmCallLogDTO): LlmCallLog {
    return {
        id: dto.id,
        timestamp: new Date(dto.timestamp),
        status: dto.status,
        input: dto.input,
        output: dto.output,
    };
}

/**
 * 批量将领域模型转换为 API DTO
 * @param logs 领域模型数组
 * @returns API DTO 数组
 */
export function llmCallLogsToDTO(logs: LlmCallLog[]): LlmCallLogDTO[] {
    return logs.map(llmCallLogToDTO);
}

/**
 * 批量将 API DTO 转换为领域模型
 * @param dtos API DTO 数组
 * @returns 领域模型数组
 */
export function llmCallLogsFromDTO(dtos: LlmCallLogDTO[]): LlmCallLog[] {
    return dtos.map(llmCallLogFromDTO);
}
