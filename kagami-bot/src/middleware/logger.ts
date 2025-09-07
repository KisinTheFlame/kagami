import { db } from "../infra/db.js";

export interface LLMCallLog {
    id?: number;
    timestamp: string;
    status: "success" | "fail";
    input: string;
    output: string;
}

class Logger {

    async logLLMCall(
        status: "success" | "fail",
        input: string,
        output: string,
    ): Promise<void> {
        try {
            const timestamp = new Date().toISOString();
            // input和output都已经是格式化好的字符串，直接存储
            await db.run(
                "INSERT INTO llm_call_logs (timestamp, status, input, output) VALUES ($1, $2, $3, $4)",
                [timestamp, status, input, output],
            );
        } catch (error) {
            console.error("Failed to log LLM call:", error);
        }
    }
}

export const logger = new Logger();
