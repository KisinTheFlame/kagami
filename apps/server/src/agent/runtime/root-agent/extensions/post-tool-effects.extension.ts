import type {
  ReActKernelExtension,
  ReActKernelRunRoundInput,
  ToolSetExecutionResult,
} from "@kagami/agent-runtime";
import type { LlmMessage } from "../../../../llm/types.js";
import type { RootAgentCompletion, RootAgentToolExecutionData } from "../root-agent-runtime.js";
import type { RootAgentExtensionHost } from "./extension-host.js";

export class RootPostToolEffectsExtension implements ReActKernelExtension<
  LlmMessage,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  private readonly host: Pick<
    RootAgentExtensionHost,
    "recordToolCall" | "flushPendingPostToolEffects"
  >;

  public constructor({
    host,
  }: {
    host: Pick<RootAgentExtensionHost, "recordToolCall" | "flushPendingPostToolEffects">;
  }) {
    this.host = host;
  }

  public async onAfterToolExecution(input: {
    request: ReActKernelRunRoundInput<LlmMessage, "agent">;
    completion: RootAgentCompletion;
    toolCall: {
      name: string;
      arguments: Record<string, unknown>;
    };
    result: ToolSetExecutionResult;
  }): Promise<{
    appendedMessages?: LlmMessage[];
    extensionData?: RootAgentToolExecutionData;
  }> {
    this.host.recordToolCall({
      toolName: input.toolCall.name,
      argumentsValue: input.toolCall.arguments,
    });

    const postToolEffects = await this.host.flushPendingPostToolEffects();

    return {
      appendedMessages: postToolEffects.messages,
      extensionData: {
        postToolEffects,
      },
    };
  }
}
