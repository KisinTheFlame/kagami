import type {
  ReActKernelExtension,
  ReActKernelRunRoundInput,
  ToolSetExecutionResult,
} from "@kagami/agent-runtime";
import type { LlmMessage } from "../../../../llm/types.js";
import { AppLogger } from "../../../../logger/logger.js";
import type { RootAgentCompletion, RootAgentToolExecutionData } from "../root-agent-runtime.js";

const logger = new AppLogger({ source: "agent.root-agent-runtime" });

export class RootToolFallbackExtension implements ReActKernelExtension<
  LlmMessage,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  public async onToolError(input: {
    request: ReActKernelRunRoundInput<LlmMessage, "agent">;
    toolCall: {
      name: string;
    };
    error: unknown;
  }): Promise<{ handled: boolean; result: ToolSetExecutionResult }> {
    logger.warn("Root agent tool call failed; returning temporary failure result", {
      event: "agent.root_agent_runtime.tool_temporary_failure",
      toolName: input.toolCall.name,
      errorName: input.error instanceof Error ? input.error.name : "Error",
      errorMessage: input.error instanceof Error ? input.error.message : String(input.error),
    });

    return {
      handled: true,
      result: createTemporaryToolFailureResult({
        toolName: input.toolCall.name,
        kind: input.request.tools.getKind(input.toolCall.name) ?? "business",
        error: input.error,
      }),
    };
  }
}

function createTemporaryToolFailureResult(input: {
  toolName: string;
  kind: ToolSetExecutionResult["kind"];
  error: unknown;
}): ToolSetExecutionResult {
  return {
    kind: input.kind,
    content: JSON.stringify({
      ok: false,
      error: "TEMPORARY_TOOL_FAILURE",
      retryable: true,
      toolName: input.toolName,
      message: `工具 ${input.toolName} 暂时调用失败了，请稍后重试，或换一种方式继续。`,
      details: input.error instanceof Error ? input.error.message : String(input.error),
    }),
  };
}
