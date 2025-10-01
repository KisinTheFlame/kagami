import { Database } from "./db.js";
import { LlmCallLogCreateRequest } from "../domain/llm_call_log.js";

export class LlmCallLogRepository {
    private database: Database;

    constructor(database: Database) {
        this.database = database;
    }

    async insert(llmCallLog: LlmCallLogCreateRequest): Promise<void> {
        try {
            await this.database.prisma().llmCallLog.create({
                data: {
                    status: llmCallLog.status,
                    input: llmCallLog.input,
                    output: llmCallLog.output,
                    timestamp: llmCallLog.timestamp,
                },
            });
        } catch (error) {
            throw new Error(`Failed to log LLM call: ${String(error)}`);
        }
    }
}

export const newLlmCallLogRepository = (database: Database) => {
    return new LlmCallLogRepository(database);
};
