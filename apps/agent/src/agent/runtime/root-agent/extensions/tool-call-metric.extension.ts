import type {
  ReActKernelExtension,
  ReActKernelRunRoundInput,
  ToolSetExecutionResult,
} from "@kagami/agent-runtime";
import type { LlmMessage } from "@kagami/llm-client";
import type { RootAgentCompletion, RootAgentToolExecutionData } from "../root-agent-runtime.js";
import type { RootAgentExtensionHost } from "./extension-host.js";

/**
 * 每次工具执行后记录一次 tool-call metric（工具名 + 参数）。这是 onAfterToolExecution 钩子的
 * 唯一职责——不追加消息、不透传 extensionData。曾经的 post-tool-effects 尾部追加通道
 * （pendingPostToolMessages / flushPendingPostToolEffects）从无生产写入方、恒为空，已随死抽象
 * 清理一并移除。
 */
export class RootToolCallMetricExtension implements ReActKernelExtension<
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  private readonly host: Pick<RootAgentExtensionHost, "recordToolCall">;

  public constructor({ host }: { host: Pick<RootAgentExtensionHost, "recordToolCall"> }) {
    this.host = host;
  }

  public async onAfterToolExecution(input: {
    request: ReActKernelRunRoundInput<"agent">;
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
    return {};
  }
}
