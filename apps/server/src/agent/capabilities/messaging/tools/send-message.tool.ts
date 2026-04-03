import { z } from "zod";
import { ZodToolComponent, type ToolContext, type ToolKind } from "@kagami/agent-runtime";
import type { AgentMessageService } from "../application/agent-message.service.js";
import type { NapcatChatTarget } from "../../../../napcat/service/napcat-gateway.service.js";

export const SEND_MESSAGE_TOOL_NAME = "send_message";

const SendMessageArgumentsSchema = z.object({
  message: z.string().trim().min(1),
});

type SendMessageToolContext = ToolContext & {
  chatTarget?: NapcatChatTarget;
};

export class SendMessageTool extends ZodToolComponent<typeof SendMessageArgumentsSchema> {
  public readonly name = SEND_MESSAGE_TOOL_NAME;
  public readonly description = "向当前 QQ 会话发送一条文本消息。";
  public readonly parameters = {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "要发送到当前会话里的文本内容。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = SendMessageArgumentsSchema;
  private readonly agentMessageService: AgentMessageService;

  public constructor({ agentMessageService }: { agentMessageService: AgentMessageService }) {
    super();
    this.agentMessageService = agentMessageService;
  }

  protected async executeTyped(
    input: z.infer<typeof SendMessageArgumentsSchema>,
    context: ToolContext,
  ): Promise<string> {
    const chatTarget = (context as SendMessageToolContext).chatTarget;
    if (!chatTarget) {
      return JSON.stringify({
        ok: false,
        error: "CHAT_CONTEXT_UNAVAILABLE",
      });
    }

    if (chatTarget.chatType === "group") {
      const result = await this.agentMessageService.sendGroupMessage({
        groupId: chatTarget.groupId,
        message: input.message,
      });
      return JSON.stringify({
        ok: true,
        chatType: "group",
        groupId: chatTarget.groupId,
        messageId: result.messageId,
      });
    }

    const result = await this.agentMessageService.sendPrivateMessage({
      userId: chatTarget.userId,
      message: input.message,
    });
    return JSON.stringify({
      ok: true,
      chatType: "private",
      userId: chatTarget.userId,
      messageId: result.messageId,
    });
  }
}
