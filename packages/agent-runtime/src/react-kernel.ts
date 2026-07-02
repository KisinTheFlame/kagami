import type { LlmMessage } from "@kagami/llm";
import type { EffectInterpreter } from "./effect.js";
import type { ToolExecutor, ToolSetExecutionResult } from "./tool/tool-catalog.js";
import type { ToolContext, Tool } from "./tool/tool-component.js";

export type ReActToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AssistantLikeMessage = {
  role: "assistant";
  content: string;
  toolCalls: ReActToolCall[];
};

export type ToolLikeMessage = {
  role: "tool";
  toolCallId: string;
  content: string;
};

type AssistantMessage = Extract<LlmMessage, { role: "assistant" }> & AssistantLikeMessage;

export interface ReActModel<
  TUsage extends string = string,
  TCompletion extends { message: AssistantMessage } = { message: AssistantMessage },
> {
  chat(
    request: {
      system?: string;
      messages: LlmMessage[];
      tools: Tool[];
      toolChoice: "auto";
    },
    options: {
      usage: TUsage;
    },
  ): Promise<TCompletion>;
}

export type ReActRoundState = {
  systemPrompt?: string;
  messages: LlmMessage[];
};

export type ReActKernelRunRoundInput<TUsage extends string> = {
  state: ReActRoundState;
  tools: ToolExecutor;
  toolContext?: ToolContext;
  usage: TUsage;
};

export type ReActToolExecution<TExtensionData = unknown> = {
  toolCall: ReActToolCall;
  result: ToolSetExecutionResult;
  appendedMessages: Array<Extract<LlmMessage, { role: "tool" }>>;
  /**
   * 本次工具执行的 `effects` 经 interpreter 翻译出的待追加消息（通常是
   * `append_message` 产的"屏幕"，如 App 列表 / 文章正文）。与 `appendedMessages`
   * （tool_result 消息）分开放，让 commit 方能按"tool 结果 → effect 屏幕"的顺序
   * 各自持久化。本字段是 #78 把 effect 下沉进 kernel 后，commit 方持久化这些
   * 消息的唯一来源——丢了它，App 的"屏幕"内容就进不了 ledger。
   */
  effectMessages: LlmMessage[];
  extensionData?: TExtensionData;
};

/** 正常完成的一轮：有真实 completion，`shouldCommit: true`，可提交可持久化。 */
export type ReActCommittedRoundResult<
  TCompletion extends { message: AssistantMessage },
  TExtensionData = unknown,
  TControl = never,
> = {
  completion: TCompletion;
  assistantMessage: AssistantMessage;
  toolExecutions: ReActToolExecution<TExtensionData>[];
  appendedMessages: LlmMessage[];
  shouldCommit: true;
  control?: TControl;
};

/**
 * 模型调用出错且被扩展 onModelError handled 的一轮：本轮没有 completion，
 * 各字段诚实置空/null（此前是用 `as unknown as TCompletion` 伪造空 completion
 * 绕类型系统——若 TCompletion 有必需字段会在运行时缺字段而编译期不报）。
 * `shouldCommit: false` 是判别符，消费方据此收窄。
 */
export type ReActHandledModelErrorRoundResult = {
  completion: null;
  assistantMessage: null;
  toolExecutions: [];
  appendedMessages: [];
  shouldCommit: false;
  control?: never;
};

export type ReActRoundResult<
  TCompletion extends { message: AssistantMessage },
  TExtensionData = unknown,
  TControl = never,
> =
  | ReActCommittedRoundResult<TCompletion, TExtensionData, TControl>
  | ReActHandledModelErrorRoundResult;

export type ReActKernelModelErrorDecision = {
  handled: boolean;
  retry: boolean;
};

export type ReActKernelToolErrorDecision = {
  handled: boolean;
  result?: ToolSetExecutionResult;
};

export interface ReActKernelExtension<
  TUsage extends string,
  TCompletion extends { message: AssistantMessage },
  TExtensionData = unknown,
> {
  onBeforeModel?(input: ReActKernelRunRoundInput<TUsage>): Promise<void> | void;
  onAfterModel?(input: {
    request: ReActKernelRunRoundInput<TUsage>;
    completion: TCompletion;
  }): Promise<void> | void;
  onModelError?(input: {
    request: ReActKernelRunRoundInput<TUsage>;
    error: unknown;
  }): Promise<ReActKernelModelErrorDecision | void> | ReActKernelModelErrorDecision | void;
  onBeforeToolExecution?(input: {
    request: ReActKernelRunRoundInput<TUsage>;
    completion: TCompletion;
    toolCall: ReActToolCall;
  }): Promise<void> | void;
  onToolError?(input: {
    request: ReActKernelRunRoundInput<TUsage>;
    completion: TCompletion;
    toolCall: ReActToolCall;
    error: unknown;
  }): Promise<ReActKernelToolErrorDecision | void> | ReActKernelToolErrorDecision | void;
  onAfterToolExecution?(input: {
    request: ReActKernelRunRoundInput<TUsage>;
    completion: TCompletion;
    toolCall: ReActToolCall;
    result: ToolSetExecutionResult;
  }):
    | Promise<{
        appendedMessages?: LlmMessage[];
        extensionData?: TExtensionData;
      } | void>
    | {
        appendedMessages?: LlmMessage[];
        extensionData?: TExtensionData;
      }
    | void;
}

/**
 * 当一轮内某个 tool 的 Interpreter.apply 返了 control 信号后，剩余 tool_call 会
 * 被跳过执行；kernel 用这段字符串作为占位 tool_result 的 content，维护 ReAct
 * 协议 "每个 tool_call 必须对应一个 tool_result"。
 */
const SKIPPED_TOOL_RESULT_CONTENT =
  "<skipped>Tool execution skipped because an earlier tool in this round produced a control signal.</skipped>";

export class ReActKernel<
  TUsage extends string = string,
  TCompletion extends { message: AssistantMessage } = { message: AssistantMessage },
  TExtensionData = unknown,
  TControl = never,
> {
  private readonly model: ReActModel<TUsage, TCompletion>;
  private readonly interpreter: EffectInterpreter<TControl>;
  private readonly extensions: ReActKernelExtension<TUsage, TCompletion, TExtensionData>[];

  public constructor({
    model,
    interpreter,
    extensions,
  }: {
    model: ReActModel<TUsage, TCompletion>;
    /**
     * Effect → 系统变更 的翻译器。kernel 每个 tool 跑完后立即把它的 `effects`
     * 喂给本 interpreter，拿到 `appendedMessages`（走原子提交）和可选的
     * `control`（透传到 `ReActRoundResult.control`，外层 Agent 用来决定循环
     * 走向）。
     *
     * Effect 是 `ToolExecutionResult` 的一等字段，跟 `content` 平级，kernel
     * 内置消费它——不再走 extension hook。
     */
    interpreter: EffectInterpreter<TControl>;
    extensions?: ReActKernelExtension<TUsage, TCompletion, TExtensionData>[];
  }) {
    this.model = model;
    this.interpreter = interpreter;
    this.extensions = extensions ?? [];
  }

  public async runRound(
    request: ReActKernelRunRoundInput<TUsage>,
  ): Promise<ReActRoundResult<TCompletion, TExtensionData, TControl>> {
    for (const extension of this.extensions) {
      await extension.onBeforeModel?.(request);
    }

    let completion: TCompletion;
    try {
      completion = await this.model.chat(
        {
          system: request.state.systemPrompt,
          messages: [...request.state.messages],
          tools: request.tools.definitions(),
          toolChoice: "auto",
        },
        {
          usage: request.usage,
        },
      );
    } catch (error) {
      for (const extension of this.extensions) {
        const decision = await extension.onModelError?.({
          request,
          error,
        });
        if (decision?.handled) {
          return {
            completion: null,
            assistantMessage: null,
            toolExecutions: [],
            appendedMessages: [],
            shouldCommit: false,
          };
        }
      }

      throw error;
    }

    for (const extension of this.extensions) {
      await extension.onAfterModel?.({
        request,
        completion,
      });
    }

    const appendedMessages: LlmMessage[] = [];
    const toolExecutions: ReActToolExecution<TExtensionData>[] = [];
    const toolContext = request.toolContext ?? {};
    const assistantMessage = completion.message;
    const toolContextMessages = [...request.state.messages];
    let capturedControl: TControl | undefined;

    for (const toolCall of assistantMessage.toolCalls) {
      if (capturedControl !== undefined) {
        // 已有 control 信号——跳过剩余 tool 执行，给它们造 synthetic tool_result
        // 维护 ReAct 协议（每个 tool_call 必有对应 tool_result）。
        const skippedResult: ToolSetExecutionResult = {
          content: SKIPPED_TOOL_RESULT_CONTENT,
          kind: "control",
        };
        const skippedToolMessages: Array<Extract<LlmMessage, { role: "tool" }>> = [
          {
            role: "tool",
            toolCallId: toolCall.id,
            content: SKIPPED_TOOL_RESULT_CONTENT,
          },
        ];
        appendedMessages.push(...skippedToolMessages);
        toolExecutions.push({
          toolCall,
          result: skippedResult,
          appendedMessages: skippedToolMessages,
          effectMessages: [],
        });
        continue;
      }

      for (const extension of this.extensions) {
        await extension.onBeforeToolExecution?.({
          request,
          completion,
          toolCall,
        });
      }

      let result: ToolSetExecutionResult;
      try {
        result = await request.tools.execute(toolCall.name, toolCall.arguments, {
          ...toolContext,
          messages: [...toolContextMessages],
          ...(request.state.systemPrompt !== undefined
            ? {
                systemPrompt: request.state.systemPrompt,
              }
            : {}),
        });
      } catch (error) {
        const fallback = await this.resolveToolError({
          request,
          completion,
          toolCall,
          error,
        });
        if (!fallback) {
          throw error;
        }

        result = fallback;
      }

      const toolMessages: Array<Extract<LlmMessage, { role: "tool" }>> =
        result.content.length > 0
          ? [
              {
                role: "tool",
                toolCallId: toolCall.id,
                content: result.content,
              },
            ]
          : [];

      // 内置消费 effects：interpreter 把 effects 翻译成 appendedMessages
      // （走原子提交）和可选 control（透传到 round result）。effects 原始数据
      // 仍保留在 toolExecutions[].result.effects 里，谁要扫谁自己扫。
      const interpretation = await this.interpreter.apply(result.effects ?? []);
      const interpretedMessages = [...interpretation.appendedMessages];
      if (interpretation.control !== undefined) {
        capturedControl = interpretation.control;
      }

      let extensionData: TExtensionData | undefined;
      const extraMessages: LlmMessage[] = [];
      for (const extension of this.extensions) {
        const augmentation = await extension.onAfterToolExecution?.({
          request,
          completion,
          toolCall,
          result,
        });
        if (!augmentation) {
          continue;
        }

        if (augmentation.appendedMessages && augmentation.appendedMessages.length > 0) {
          extraMessages.push(...augmentation.appendedMessages);
        }

        if (augmentation.extensionData !== undefined) {
          extensionData = augmentation.extensionData;
        }
      }

      const combinedMessages = [...toolMessages, ...interpretedMessages, ...extraMessages];
      appendedMessages.push(...combinedMessages);
      toolContextMessages.push(...interpretedMessages, ...extraMessages);
      toolExecutions.push({
        toolCall,
        result,
        appendedMessages: toolMessages,
        effectMessages: interpretedMessages,
        ...(extensionData !== undefined ? { extensionData } : {}),
      });
    }

    return {
      completion,
      assistantMessage,
      toolExecutions,
      appendedMessages,
      shouldCommit: true,
      ...(capturedControl !== undefined ? { control: capturedControl } : {}),
    };
  }

  private async resolveToolError(input: {
    request: ReActKernelRunRoundInput<TUsage>;
    completion: TCompletion;
    toolCall: ReActToolCall;
    error: unknown;
  }): Promise<ToolSetExecutionResult | null> {
    for (const extension of this.extensions) {
      const decision = await extension.onToolError?.(input);
      if (decision?.handled) {
        return decision.result ?? null;
      }
    }

    return null;
  }
}
