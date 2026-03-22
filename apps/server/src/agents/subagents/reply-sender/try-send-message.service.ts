import { z } from "zod";
import {
  createReplyReviewReminderMessage,
  createReplyThoughtMessage,
  createReplyThoughtReminderMessage,
  createReplyWriterReminderMessage,
} from "../../../context/context-message-factory.js";
import type { LlmClient } from "../../../llm/client.js";
import type { LlmMessage } from "../../../llm/types.js";
import type { AgentMessageService } from "../../../service/agent-message.service.js";
import type { ToolExecutor } from "../../../tools/index.js";
import { REVIEW_REPLY_STRATEGY_TOOL_NAME } from "./review-reply-strategy.tool.js";
import { REPLY_THOUGHT_TOOL_NAME } from "./reply-thought.tool.js";
import { WRITE_REPLY_MESSAGE_TOOL_NAME } from "./write-reply-message.tool.js";

const ReviewReplyStrategyResultSchema = z.object({
  approve: z.boolean(),
  thought: z.string().trim().min(1),
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
  private readonly replyThoughtTools: ToolExecutor;
  private readonly replyReviewTools: ToolExecutor;
  private readonly replyWriterTools: ToolExecutor;

  public constructor({
    llmClient,
    agentMessageService,
    replyThoughtTools,
    replyReviewTools,
    replyWriterTools,
  }: {
    llmClient: LlmClient;
    agentMessageService: AgentMessageService;
    replyThoughtTools: ToolExecutor;
    replyReviewTools: ToolExecutor;
    replyWriterTools: ToolExecutor;
  }) {
    this.llmClient = llmClient;
    this.agentMessageService = agentMessageService;
    this.replyThoughtTools = replyThoughtTools;
    this.replyReviewTools = replyReviewTools;
    this.replyWriterTools = replyWriterTools;
  }

  public async trySend(input: TrySendMessageInput): Promise<TrySendMessageResult> {
    const thought = await this.generateReplyThought(input);
    if (!thought) {
      return { sent: false };
    }

    const baseMessages = [...input.contextMessages, createReplyThoughtMessage(thought)];
    const reviewResult = await this.reviewReplyStrategy({
      systemPrompt: input.systemPrompt,
      contextMessages: baseMessages,
    });
    if (!reviewResult?.approve) {
      return { sent: false };
    }

    const message = await this.writeReplyMessage({
      systemPrompt: input.systemPrompt,
      contextMessages: baseMessages,
      reviewThought: reviewResult.thought,
    });
    if (!message) {
      return { sent: false };
    }

    const sendResult = await this.agentMessageService.sendGroupMessage({ message });
    return {
      sent: true,
      message,
      messageId: sendResult.messageId,
    };
  }

  private async generateReplyThought(input: TrySendMessageInput): Promise<string | null> {
    const response = await this.llmClient.chat(
      {
        system: input.systemPrompt,
        messages: [...input.contextMessages, createReplyThoughtReminderMessage()],
        tools: this.replyThoughtTools.definitions(),
        toolChoice: { tool_name: REPLY_THOUGHT_TOOL_NAME },
      },
      {
        usage: "replyThought",
      },
    );

    const toolCall = response.message.toolCalls[0];
    if (!toolCall || toolCall.name !== REPLY_THOUGHT_TOOL_NAME) {
      return null;
    }

    const executionResult = await this.replyThoughtTools.execute(
      toolCall.name,
      toolCall.arguments,
      {},
    );
    const thought = executionResult.content.trim();
    return thought.length > 0 ? thought : null;
  }

  private async reviewReplyStrategy(input: {
    systemPrompt: string;
    contextMessages: LlmMessage[];
  }): Promise<z.infer<typeof ReviewReplyStrategyResultSchema> | null> {
    const response = await this.llmClient.chat(
      {
        system: input.systemPrompt,
        messages: [...input.contextMessages, createReplyReviewReminderMessage()],
        tools: this.replyReviewTools.definitions(),
        toolChoice: { tool_name: REVIEW_REPLY_STRATEGY_TOOL_NAME },
      },
      {
        usage: "replyReview",
      },
    );

    const toolCall = response.message.toolCalls[0];
    if (!toolCall || toolCall.name !== REVIEW_REPLY_STRATEGY_TOOL_NAME) {
      return null;
    }

    const executionResult = await this.replyReviewTools.execute(
      toolCall.name,
      toolCall.arguments,
      {},
    );
    const parsed = safeParseReviewResult(executionResult.content);
    return parsed?.success ? parsed.data : null;
  }

  private async writeReplyMessage(input: {
    systemPrompt: string;
    contextMessages: LlmMessage[];
    reviewThought: string;
  }): Promise<string | null> {
    const response = await this.llmClient.chat(
      {
        system: input.systemPrompt,
        messages: [...input.contextMessages, createReplyWriterReminderMessage(input.reviewThought)],
        tools: this.replyWriterTools.definitions(),
        toolChoice: { tool_name: WRITE_REPLY_MESSAGE_TOOL_NAME },
      },
      {
        usage: "replyWriter",
      },
    );

    const toolCall = response.message.toolCalls[0];
    if (!toolCall || toolCall.name !== WRITE_REPLY_MESSAGE_TOOL_NAME) {
      return null;
    }

    const executionResult = await this.replyWriterTools.execute(
      toolCall.name,
      toolCall.arguments,
      {},
    );
    const message = executionResult.content.trim();
    return message.length > 0 ? message : null;
  }
}

function safeParseReviewResult(
  value: string,
): z.SafeParseReturnType<unknown, z.infer<typeof ReviewReplyStrategyResultSchema>> | null {
  try {
    return ReviewReplyStrategyResultSchema.safeParse(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}
