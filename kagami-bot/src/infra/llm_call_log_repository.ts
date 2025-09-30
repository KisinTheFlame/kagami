import { Database } from "./db.js";

export class LlmCallLogRepository {
    private database: Database;

    constructor(database: Database) {
        this.database = database;
    }

    async logLLMCall(
        status: "success" | "fail",
        input: string,
        output: string,
    ): Promise<void> {
        try {
            await this.database.getPrisma().llmCallLog.create({
                data: {
                    status,
                    input,
                    output,
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
