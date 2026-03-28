import { randomUUID } from "node:crypto";
import type { ToolSetExecutionResult } from "@kagami/agent-runtime";
import type { NapcatGroupMessageEvent } from "../../runtime/event/event.js";
import type { LlmChatObservation } from "../../../llm/client.js";
import { AppLogger } from "../../../logger/logger.js";
import type { LoopRunDao } from "./loop-run.dao.js";

const logger = new AppLogger({ source: "observability.loop-run-recorder" });

type LoopRunRecorderDeps = {
  loopRunDao: LoopRunDao;
};

export class LoopRunRecorder {
  private readonly loopRunDao: LoopRunDao;

  public constructor({ loopRunDao }: LoopRunRecorderDeps) {
    this.loopRunDao = loopRunDao;
  }

  public async startRun(input: {
    event: NapcatGroupMessageEvent;
    startedAt: Date;
  }): Promise<string> {
    const loopRunId = randomUUID();
    const triggerPayload = toTriggerPayload(input.event);
    try {
      await this.loopRunDao.createRun({
        id: loopRunId,
        groupId: input.event.groupId,
        triggerMessageId: input.event.messageId,
        triggerPayload,
        startedAt: input.startedAt,
      });
      await this.loopRunDao.createStep({
        loopRunId,
        seq: 0,
        type: "trigger_message",
        title: "触发消息",
        status: "success",
        payload: triggerPayload,
        startedAt: input.startedAt,
        finishedAt: input.startedAt,
        durationMs: 0,
      });
    } catch (error) {
      logger.errorWithCause("Failed to start loop run record", error, {
        event: "loop_run.record_start_failed",
        groupId: input.event.groupId,
        messageId: input.event.messageId,
      });
    }

    return loopRunId;
  }

  public async recordLlmCall(input: {
    loopRunId: string;
    seq: number;
    observation: LlmChatObservation;
  }): Promise<void> {
    try {
      await this.loopRunDao.createStep({
        loopRunId: input.loopRunId,
        seq: input.seq,
        type: "llm_call",
        title: "LLM 调用",
        status: input.observation.status === "success" ? "success" : "failed",
        payload: {
          provider: input.observation.provider,
          model: input.observation.model,
          requestId: input.observation.requestId,
          requestPayload: input.observation.request,
          responsePayload: input.observation.response ?? null,
          usage: input.observation.response?.usage ?? null,
          error: input.observation.error ?? null,
        },
        startedAt: input.observation.startedAt,
        finishedAt: input.observation.finishedAt,
        durationMs: input.observation.latencyMs,
      });
    } catch (error) {
      logger.errorWithCause("Failed to record loop llm step", error, {
        event: "loop_run.record_llm_failed",
        loopRunId: input.loopRunId,
        requestId: input.observation.requestId,
      });
    }
  }

  public async recordToolCall(input: {
    loopRunId: string;
    seq: number;
    toolName: string;
    toolCallId: string;
    argumentsValue: Record<string, unknown>;
    startedAt: Date;
  }): Promise<void> {
    try {
      await this.loopRunDao.createStep({
        loopRunId: input.loopRunId,
        seq: input.seq,
        type: "tool_call",
        title: `工具调用: ${input.toolName}`,
        status: "success",
        payload: {
          toolName: input.toolName,
          toolCallId: input.toolCallId,
          arguments: input.argumentsValue,
        },
        startedAt: input.startedAt,
        finishedAt: input.startedAt,
        durationMs: 0,
      });
    } catch (error) {
      logger.errorWithCause("Failed to record tool call step", error, {
        event: "loop_run.record_tool_call_failed",
        loopRunId: input.loopRunId,
        toolName: input.toolName,
      });
    }
  }

  public async recordToolResult(input: {
    loopRunId: string;
    seq: number;
    toolName: string;
    toolCallId: string;
    result: ToolSetExecutionResult;
    startedAt: Date;
    finishedAt: Date;
  }): Promise<void> {
    try {
      await this.loopRunDao.createStep({
        loopRunId: input.loopRunId,
        seq: input.seq,
        type: "tool_result",
        title: `工具结果: ${input.toolName}`,
        status: isToolResultFailure(input.result) ? "failed" : "success",
        payload: {
          toolName: input.toolName,
          toolCallId: input.toolCallId,
          result: parseToolResult(input.result.content),
        },
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
      });
    } catch (error) {
      logger.errorWithCause("Failed to record tool result step", error, {
        event: "loop_run.record_tool_result_failed",
        loopRunId: input.loopRunId,
        toolName: input.toolName,
      });
    }
  }

  public async finishRun(input: {
    loopRunId: string;
    status: "success" | "failed";
    startedAt: Date;
    finishedAt: Date;
    outcome: Record<string, unknown>;
    seq: number;
  }): Promise<void> {
    try {
      const durationMs = input.finishedAt.getTime() - input.startedAt.getTime();
      await this.loopRunDao.createStep({
        loopRunId: input.loopRunId,
        seq: input.seq,
        type: "final_result",
        title: "执行结果",
        status: input.status,
        payload: {
          outcome: input.outcome,
        },
        startedAt: input.finishedAt,
        finishedAt: input.finishedAt,
        durationMs: 0,
      });
      await this.loopRunDao.finishRun({
        id: input.loopRunId,
        status: input.status,
        finishedAt: input.finishedAt,
        durationMs,
      });
    } catch (error) {
      logger.errorWithCause("Failed to finish loop run record", error, {
        event: "loop_run.record_finish_failed",
        loopRunId: input.loopRunId,
      });
    }
  }
}

function toTriggerPayload(event: NapcatGroupMessageEvent): Record<string, unknown> {
  return {
    messageId: event.messageId,
    groupId: event.groupId,
    userId: event.userId,
    nickname: event.nickname,
    rawMessage: event.rawMessage,
    messageSegments: event.messageSegments,
    eventTime: event.time ? new Date(event.time * 1000).toISOString() : null,
  };
}

function parseToolResult(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

function isToolResultFailure(result: ToolSetExecutionResult): boolean {
  const parsed = parseToolResult(result.content);
  if (typeof parsed === "string") {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return false;
  }

  const ok = (parsed as Record<string, unknown>).ok;
  if (ok === false) {
    return true;
  }

  return false;
}
