import { z } from "zod";
import { ZodToolComponent, type ToolContext, type ToolKind } from "@kagami/agent-runtime";
import type { AgentMessageService } from "../application/agent-message.service.js";
import type { PendingDraftStore } from "../application/pending-draft.store.js";
import type { AiToneScorer } from "../infra/ai-tone-scorer.js";
import type { NapcatChatTarget } from "../../../../napcat/application/napcat-gateway.service.js";

export const SEND_MESSAGE_TOOL_NAME = "send_message";

const SendMessageArgumentsSchema = z.object({
  message: z.string().trim().min(1).optional(),
  reply_to: z.number().int().positive().optional(),
  confirm_last: z.boolean().optional().default(false),
});

type SendMessageToolContext = ToolContext & {
  chatTarget?: NapcatChatTarget;
};

export interface AiToneGuardConfig {
  readonly enabled: boolean;
  readonly blockThreshold: number;
}

type DispatchResult =
  | { chatType: "group"; groupId: string; messageId: number }
  | { chatType: "private"; userId: string; messageId: number };

export class SendMessageTool extends ZodToolComponent<typeof SendMessageArgumentsSchema> {
  public readonly name = SEND_MESSAGE_TOOL_NAME;
  public readonly description =
    "向当前 QQ 会话发送一条文本消息。发送前会对内容做 AI 味评分（0~1），响应里的 aiToneScore 越高越像 AI 腔；" +
    "若评分过高会被拦下不发，可在下次调用带 confirm_last=true 原样补发上一条被拦的内容。" +
    '想引用回复某条消息时，带上 reply_to=那条消息的 id（消息渲染里 <qq_message id="..."> 的 id）。';
  public readonly parameters = {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "要发送到当前会话里的文本内容。confirm_last 为 true 时可省略。",
      },
      reply_to: {
        type: "number",
        description:
          '可选。要引用回复的目标消息 id，取自消息渲染里的 <qq_message id="...">。' +
          "带上后这条消息会作为对该消息的引用回复发出；不需要引用就省略。",
      },
      confirm_last: {
        type: "boolean",
        description:
          "为 true 时忽略本次 message，原样补发上一次因 AI 味过高被拦下的内容；" +
          "仅当最近一次发送被拦、且其后没有成功发送时有效。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = SendMessageArgumentsSchema;
  private readonly agentMessageService: AgentMessageService;
  private readonly aiToneScorer: AiToneScorer;
  private readonly pendingDraftStore: PendingDraftStore;
  private readonly aiTone: AiToneGuardConfig;

  public constructor({
    agentMessageService,
    aiToneScorer,
    pendingDraftStore,
    aiTone,
  }: {
    agentMessageService: AgentMessageService;
    aiToneScorer: AiToneScorer;
    pendingDraftStore: PendingDraftStore;
    aiTone: AiToneGuardConfig;
  }) {
    super();
    this.agentMessageService = agentMessageService;
    this.aiToneScorer = aiToneScorer;
    this.pendingDraftStore = pendingDraftStore;
    this.aiTone = aiTone;
  }

  protected async executeTyped(
    input: z.infer<typeof SendMessageArgumentsSchema>,
    context: ToolContext,
  ): Promise<string> {
    if (input.confirm_last) {
      return await this.handleConfirmLast(input.message);
    }

    if (!input.message) {
      return JSON.stringify({
        ok: false,
        error: "EMPTY_MESSAGE",
        note: "message 不能为空（除非带 confirm_last=true 补发上一条被拦内容）。",
      });
    }

    const chatTarget = (context as SendMessageToolContext).chatTarget;
    if (!chatTarget) {
      return JSON.stringify({ ok: false, error: "CHAT_CONTEXT_UNAVAILABLE" });
    }

    // 门控关闭：完全退化为原发送行为，不打分、不拦截、响应不含 aiToneScore。
    if (!this.aiTone.enabled) {
      const result = await this.dispatch(chatTarget, input.message, input.reply_to);
      this.pendingDraftStore.clear();
      return JSON.stringify({ ok: true, ...result });
    }

    const score = this.aiToneScorer.proba(input.message);
    if (score >= this.aiTone.blockThreshold) {
      // 拦截：不发，存草稿（覆盖旧草稿），回带分数与提示。回复目标一并存，补发时保留引用。
      this.pendingDraftStore.set({
        chatTarget,
        message: input.message,
        score,
        replyToMessageId: input.reply_to,
      });
      return JSON.stringify({
        ok: false,
        blocked: true,
        aiToneScore: round(score),
        threshold: this.aiTone.blockThreshold,
        note: "这条 AI 味偏高，没发出去。想原样发就下次调用带 confirm_last=true，或者重写一条更像真人的。",
      });
    }

    // 通过：正常发送，回带分数（教学信号）；成功即清空待确认草稿。
    const result = await this.dispatch(chatTarget, input.message, input.reply_to);
    this.pendingDraftStore.clear();
    return JSON.stringify({ ok: true, ...result, aiToneScore: round(score) });
  }

  private async handleConfirmLast(ignoredMessage: string | undefined): Promise<string> {
    const draft = this.pendingDraftStore.peek();
    if (!draft) {
      return JSON.stringify({
        ok: false,
        error: "NO_PENDING_DRAFT",
        note: "最近没有被拦下的发言，无法补发。",
      });
    }

    try {
      const result = await this.dispatch(draft.chatTarget, draft.message, draft.replyToMessageId);
      this.pendingDraftStore.clear();
      return JSON.stringify({
        ok: true,
        ...result,
        confirmedResend: true,
        aiToneScore: round(draft.score),
        ...(ignoredMessage
          ? { note: "已忽略本次 message，补发的是上一次被 AI 味拦下的草稿。" }
          : {}),
      });
    } catch (error) {
      // 重发失败：保留草稿，让其可再次 confirm_last 重试。
      return JSON.stringify({
        ok: false,
        error: "RESEND_FAILED",
        note: `补发上一条被拦内容失败：${error instanceof Error ? error.message : String(error)}。草稿已保留，可稍后再带 confirm_last=true 重试。`,
      });
    }
  }

  private async dispatch(
    chatTarget: NapcatChatTarget,
    message: string,
    replyToMessageId?: number,
  ): Promise<DispatchResult> {
    if (chatTarget.chatType === "group") {
      const result = await this.agentMessageService.sendGroupMessage({
        groupId: chatTarget.groupId,
        message,
        replyToMessageId,
      });
      return { chatType: "group", groupId: chatTarget.groupId, messageId: result.messageId };
    }

    const result = await this.agentMessageService.sendPrivateMessage({
      userId: chatTarget.userId,
      message,
      replyToMessageId,
    });
    return { chatType: "private", userId: chatTarget.userId, messageId: result.messageId };
  }
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
