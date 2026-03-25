import { z } from "zod";
import { createReplyDecisionReminderMessage } from "../../../context/context-message-factory.js";
import type { LlmClient } from "../../../llm/client.js";
import type { LlmMessage } from "../../../llm/types.js";
import type { AgentMessageService } from "../../../service/agent-message.service.js";
import type { ToolExecutor } from "../../../tools/index.js";
import { DECIDE_REPLY_TOOL_NAME } from "./decide-reply.tool.js";

const ReplyDecisionResultSchema = z.object({
  shouldSend: z.boolean(),
  message: z.string().trim(),
});

export type TrySendMessageInput = {
  systemPrompt: string;
  contextMessages: LlmMessage[];
};

export type TrySendMessageResult =
  | {
      sent: false;
    }
  | {
      sent: true;
      message: string;
      messageId: number;
    };

export class TrySendMessageService {
  private readonly llmClient: LlmClient;
  private readonly agentMessageService: AgentMessageService;
  private readonly replyDecisionTools: ToolExecutor;

  public constructor({
    llmClient,
    agentMessageService,
    replyDecisionTools,
  }: {
    llmClient: LlmClient;
    agentMessageService: AgentMessageService;
    replyDecisionTools: ToolExecutor;
  }) {
    this.llmClient = llmClient;
    this.agentMessageService = agentMessageService;
    this.replyDecisionTools = replyDecisionTools;
  }

  public async trySend(input: TrySendMessageInput): Promise<TrySendMessageResult> {
    const decision = await this.decideReply(input);
    if (!decision?.shouldSend) {
      return { sent: false };
    }

    const message = decision.message.trim();
    if (message.length === 0) {
      return { sent: false };
    }

    const sendResult = await this.agentMessageService.sendGroupMessage({ message });
    return {
      sent: true,
      message,
      messageId: sendResult.messageId,
    };
  }

  private async decideReply(
    input: TrySendMessageInput,
  ): Promise<z.infer<typeof ReplyDecisionResultSchema> | null> {
    const response = await this.llmClient.chat(
      {
        system: input.systemPrompt,
        messages: [...input.contextMessages, createReplyDecisionReminderMessage()],
        tools: this.replyDecisionTools.definitions(),
        toolChoice: "required",
      },
      {
        usage: "replyDecider",
      },
    );

    const toolCall = response.message.toolCalls[0];
    if (!toolCall || toolCall.name !== DECIDE_REPLY_TOOL_NAME) {
      return null;
    }

    const executionResult = await this.replyDecisionTools.execute(
      toolCall.name,
      toolCall.arguments,
      {},
    );
    const parsed = safeParseDecisionResult(executionResult.content);
    return parsed?.success ? parsed.data : null;
  }
}

function safeParseDecisionResult(
  value: string,
): z.SafeParseReturnType<unknown, z.infer<typeof ReplyDecisionResultSchema>> | null {
  try {
    return ReplyDecisionResultSchema.safeParse(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}
