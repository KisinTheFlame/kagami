import { z } from "zod";
import type { AgentMessageService } from "../../../service/agent-message.service.js";
import { ZodToolComponent, type ToolContext, type ToolKind } from "../../core/tool-component.js";

export const SEND_MESSAGE_TOOL_NAME = "send_message";

const SendMessageArgumentsSchema = z.object({
  message: z.string().trim().min(1),
});

export class SendMessageTool extends ZodToolComponent<typeof SendMessageArgumentsSchema> {
  public readonly name = SEND_MESSAGE_TOOL_NAME;
  public readonly description = "向当前监听的 QQ 群发送一条文本消息。";
  public readonly parameters = {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "要发送到群里的文本内容。",
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
    void context;
    const result = await this.agentMessageService.sendGroupMessage(input);
    return JSON.stringify({
      ok: true,
      messageId: result.messageId,
    });
  }
}
