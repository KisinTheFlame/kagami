import { Database } from "./db.js";
import type { LlmCallLog, LlmCallLogCreateRequest, LlmCallStatus } from "kagami-types/domain/llm_call_log";

type QueryListParams = {
    page: number,
    limit: number,
    status?: "success" | "fail",
    startTime?: Date,
    endTime?: Date,
    orderBy: "timestamp" | "status" | "id",
    orderDirection: "asc" | "desc",
};

type QueryListResult = {
    data: LlmCallLog[],
    total: number,
};

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

    async find(params: QueryListParams): Promise<QueryListResult> {
        const where = {
            ...(params.status && { status: params.status }),
            ...(params.startTime || params.endTime
                ? {
                    timestamp: {
                        ...(params.startTime && { gte: params.startTime }),
                        ...(params.endTime && { lte: params.endTime }),
                    },
                }
                : {}),
        };

        const [rows, total] = await Promise.all([
            this.database.prisma().llmCallLog.findMany({
                where,
                skip: (params.page - 1) * params.limit,
                take: params.limit,
                orderBy: {
                    [params.orderBy]: params.orderDirection,
                },
            }),
            this.database.prisma().llmCallLog.count({ where }),
        ]);

        const data: LlmCallLog[] = rows.map(row => ({
            id: row.id,
            timestamp: row.timestamp,
            status: row.status as LlmCallStatus,
            input: row.input,
            output: row.output,
        }));

        return { data, total };
    }

    async findById(id: number): Promise<LlmCallLog | null> {
        const row = await this.database.prisma().llmCallLog.findUnique({
            where: { id },
        });

        if (!row) {
            return null;
        }

        return {
            id: row.id,
            timestamp: row.timestamp,
            status: row.status as LlmCallStatus,
            input: row.input,
            output: row.output,
        };
    }
}

export const newLlmCallLogRepository = (database: Database) => {
    return new LlmCallLogRepository(database);
};
