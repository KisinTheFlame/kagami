import type {
  ReActKernelExtension,
  ReActKernelRunRoundInput,
  ToolSetExecutionResult,
} from "@kagami/agent-runtime";
import type { LlmClient } from "../../../../../llm/client.js";
import type { LlmMessage } from "../../../../../llm/types.js";
import type { StoryRuntimeTelemetry } from "../story-runtime-telemetry.js";

type StoryCompletion = Awaited<ReturnType<LlmClient["chat"]>>;

/**
 * 把 ReAct kernel 三个生命周期事件统一转发到 telemetry 的 record/transition 方法。
 * 三个 hook 单独写成 extension class 是没意义的重复（都只是一行转发），所以合并在这里。
 */
export class StoryTelemetryKernelExtension implements ReActKernelExtension<
  LlmMessage,
  "storyAgent",
  StoryCompletion
> {
  private readonly telemetry: StoryRuntimeTelemetry;

  public constructor({ telemetry }: { telemetry: StoryRuntimeTelemetry }) {
    this.telemetry = telemetry;
  }

  public onAfterModel(input: {
    request: ReActKernelRunRoundInput<LlmMessage, "storyAgent">;
    completion: StoryCompletion;
  }): void {
    void input.request;
    this.telemetry.recordLlmCall(input.completion);
  }

  public onBeforeToolExecution(input: {
    request: ReActKernelRunRoundInput<LlmMessage, "storyAgent">;
    completion: StoryCompletion;
    toolCall: {
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    };
  }): void {
    void input;
    this.telemetry.transitionTo("executing_tool");
  }

  public async onAfterToolExecution(input: {
    request: ReActKernelRunRoundInput<LlmMessage, "storyAgent">;
    completion: StoryCompletion;
    toolCall: {
      name: string;
      arguments: Record<string, unknown>;
    };
    result: ToolSetExecutionResult;
  }): Promise<void> {
    void input.request;
    void input.completion;
    this.telemetry.recordToolCall({
      toolName: input.toolCall.name,
      argumentsValue: input.toolCall.arguments,
      resultContent: input.result.content,
    });
  }
}
