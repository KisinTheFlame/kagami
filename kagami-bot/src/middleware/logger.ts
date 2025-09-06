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
        input: unknown,
        output: unknown,
    ): Promise<void> {
        try {
            const timestamp = new Date().toISOString();
            const inputStr = typeof input === "string" ? input : JSON.stringify(input);
            const outputStr = typeof output === "string" ? output : JSON.stringify(output);

            await db.run(
                "INSERT INTO llm_call_logs (timestamp, status, input, output) VALUES ($1, $2, $3, $4)",
                [timestamp, status, inputStr, outputStr],
            );
        } catch (error) {
            console.error("Failed to log LLM call:", error);
        }
    }
}

export const logger = new Logger();
