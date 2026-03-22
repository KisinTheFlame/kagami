import { z } from "zod";
import type { TrySendMessageService } from "../../../agents/subagents/reply-sender/index.js";
import {
  ZodToolComponent,
  type ToolContext,
  type ToolExecutionResult,
  type ToolKind,
} from "../../core/tool-component.js";

export const TRY_SEND_MESSAGE_TOOL_NAME = "try_send_message";

const TrySendMessageArgumentsSchema = z.object({});

export class TrySendMessageTool extends ZodToolComponent<typeof TrySendMessageArgumentsSchema> {
  public readonly name = TRY_SEND_MESSAGE_TOOL_NAME;
  public readonly description =
    "尝试发送一条群消息。工具会在内部完成回复思考、策略审核和文案编写，并在结束当前轮次前决定是否真的发送。";
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = TrySendMessageArgumentsSchema;
  private readonly trySendMessageService: TrySendMessageService;

  public constructor({ trySendMessageService }: { trySendMessageService: TrySendMessageService }) {
    super();
    this.trySendMessageService = trySendMessageService;
  }

  protected override formatExecutionError(): string {
    return JSON.stringify({
      sent: false,
    });
  }

  protected async executeTyped(
    input: z.infer<typeof TrySendMessageArgumentsSchema>,
    context: ToolContext,
  ): Promise<ToolExecutionResult> {
    const systemPrompt = context.systemPrompt?.trim();
    const contextMessages = context.messages;

    if (!systemPrompt || !contextMessages) {
      return {
        content: JSON.stringify({
          sent: false,
        }),
        signal: "finish_round",
      };
    }

    const result = await this.trySendMessageService.trySend({
      systemPrompt,
      contextMessages,
    });

    return {
      content: JSON.stringify(result),
      signal: "finish_round",
    };
  }
}
