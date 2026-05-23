import type {
  ReActKernelExtension,
  ReActKernelRunRoundInput,
  ToolSetExecutionResult,
} from "@kagami/agent-runtime";
import type { LlmMessage } from "../../../../llm/types.js";
import type { RootAgentEffect } from "../../effect/root-agent-effect.js";
import type { RootEffectInterpreter } from "../../effect/root-effect-interpreter.js";
import type { RootAgentCompletion, RootAgentToolExecutionData } from "../root-agent-runtime.js";

/**
 * ReAct kernel extension：把工具返回的 `ToolExecutionResult.effects` 喂给
 * RootEffectInterpreter 解释执行。
 *
 * 即时变更（switch_app / switch_state）由 Interpreter 直接改 session 字段；
 * 延迟追加（append_message）累积成 LlmMessage[] 返出，通过 onAfterToolExecution
 * 的 `appendedMessages` 进 ReAct kernel 的原子 commit 路径——保证一轮内消息
 * 顺序、KV 缓存友好。
 *
 * 设计依据：[docs/effect-model.md](docs/effect-model.md)。
 */
export class RootEffectsApplyExtension implements ReActKernelExtension<
  LlmMessage,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  private readonly interpreter: RootEffectInterpreter;

  public constructor({ interpreter }: { interpreter: RootEffectInterpreter }) {
    this.interpreter = interpreter;
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
    const effects = input.result.effects;
    if (!effects || effects.length === 0) {
      return {};
    }
    const appendedMessages = await this.interpreter.applyAll(effects as readonly RootAgentEffect[]);
    if (appendedMessages.length === 0) {
      return {};
    }
    return { appendedMessages };
  }
}
