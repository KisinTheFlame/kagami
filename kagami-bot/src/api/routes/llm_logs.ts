import { Router, Request, Response } from "express";
import { LlmCallLogRepository } from "../../infra/llm_call_log_repository.js";
import {
    llmLogQueryParamsSchema,
    type LlmLogListResponse,
    type ErrorResponse,
    type LlmCallLogDTO,
} from "kagami-types/dto/llm_call_log";
import { llmCallLogToDTO, llmCallLogsToDTO } from "kagami-types/converter/llm_call_log";
import { ZodError } from "zod";

export const createLlmLogsRouter = (repository: LlmCallLogRepository): Router => {
    const router = Router();

    router.get("/", async (req: Request, res: Response<LlmLogListResponse | ErrorResponse>) => {
        try {
            const params = llmLogQueryParamsSchema.parse(req.query);

            const result = await repository.find({
                page: params.page,
                limit: params.limit,
                status: params.status,
                startTime: params.startTime ? new Date(params.startTime) : undefined,
                endTime: params.endTime ? new Date(params.endTime) : undefined,
                orderBy: params.orderBy,
                orderDirection: params.orderDirection,
            });

            res.json({
                data: llmCallLogsToDTO(result.data),
                total: result.total,
                page: params.page,
                limit: params.limit,
            });
        } catch (error) {
            if (error instanceof ZodError) {
                res.status(400).json({ error: error.errors.map(e => e.message).join(", ") });
            } else {
                console.error("Error querying LLM logs:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        }
    });

    router.get("/:id", async (req: Request, res: Response<LlmCallLogDTO | ErrorResponse>) => {
        try {
            const id = Number.parseInt(req.params.id, 10);
            if (Number.isNaN(id)) {
                res.status(400).json({ error: "Invalid ID parameter" });
                return;
            }

            const log = await repository.findById(id);
            if (!log) {
                res.status(404).json({ error: "Log not found" });
                return;
            }

            res.json(llmCallLogToDTO(log));
        } catch (error) {
            console.error("Error fetching LLM log:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    return router;
};
