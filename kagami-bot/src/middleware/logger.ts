import { db } from "../infra/prisma.js";

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
            // input和output都已经是格式化好的字符串，直接存储
            await db.logLLMCall(status, input, output);
        } catch (error) {
            console.error("Failed to log LLM call:", error);
        }
    }
}

export const logger = new Logger();
