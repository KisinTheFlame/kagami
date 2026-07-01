import { z } from "zod";
import { ZodToolComponent, type ToolKind } from "@kagami/agent-runtime";
import { BizError } from "@kagami/kernel/errors/biz-error";
import type { NapcatChatTarget } from "../../../../napcat/application/napcat-gateway.service.js";
import type { ResourceService } from "../../resource/application/resource.service.js";
import type { AgentMessageService } from "../application/agent-message.service.js";

export const SEND_RESOURCE_TOOL_NAME = "send_resource";

const SendResourceArgumentsSchema = z.object({
  resid: z.string().trim().min(1),
  reply_to: z.number().int().positive().optional(),
});

/**
 * 按 resId 把一份已存图片资源发到当前 QQ 会话。资源经 OSS 取回字节、以 base64:// 形态
 * 发送（自包含，不依赖 napcat 访问 OSS）。v1 只支持图片资源；非图片 / 不存在 / 超限都报错不发。
 *
 * 不经 AI 味门控 / pending draft / confirm_last——图片不是文本发言，刻意如此。
 * 出站只回 resid + messageId，**不回 base64**。
 */
export class SendResourceTool extends ZodToolComponent<typeof SendResourceArgumentsSchema> {
  public readonly name = SEND_RESOURCE_TOOL_NAME;
  public readonly description =
    "按 resid 把一张已存图片资源发到当前打开的 QQ 会话。resid 形如 res-N（取自消息里的 " +
    "[resid: res-N] 占位符或截图返回）。可带 reply_to 引用某条消息。" +
    "先 open_conversation 才能发；目前只支持图片资源。";
  public readonly parameters = {
    type: "object",
    properties: {
      resid: { type: "string", description: "要发送的图片资源 id，形如 res-N（含 res- 前缀）。" },
      reply_to: {
        type: "number",
        description: '可选。要引用回复的目标消息 id，取自 <qq_message id="...">。',
      },
    },
    required: ["resid"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = SendResourceArgumentsSchema;
  private readonly resourceService: ResourceService;
  private readonly agentMessageService: AgentMessageService;
  /** 当前发送目标：来自持有该工具的 QqApp 的当前会话。chatTarget 是 QQ 私有概念，不经 session。 */
  private readonly getChatTarget: () => NapcatChatTarget | undefined;

  public constructor({
    resourceService,
    agentMessageService,
    getChatTarget,
  }: {
    resourceService: ResourceService;
    agentMessageService: AgentMessageService;
    getChatTarget: () => NapcatChatTarget | undefined;
  }) {
    super();
    this.resourceService = resourceService;
    this.agentMessageService = agentMessageService;
    this.getChatTarget = getChatTarget;
  }

  protected async executeTyped(
    input: z.infer<typeof SendResourceArgumentsSchema>,
  ): Promise<string> {
    const chatTarget = this.getChatTarget();
    if (!chatTarget) {
      return JSON.stringify({
        ok: false,
        error: "CHAT_CONTEXT_UNAVAILABLE",
        message: "当前没有打开的会话，先用 open_conversation 打开一个会话再发。",
      });
    }

    let resolved;
    try {
      resolved = await this.resourceService.resolve(input.resid);
    } catch (error) {
      const reason =
        error instanceof BizError ? (error.meta?.reason ?? "SEND_FAILED") : "SEND_FAILED";
      return JSON.stringify({
        ok: false,
        resid: input.resid,
        error: reason,
        note: error instanceof Error ? error.message : String(error),
      });
    }

    if (!resolved.isImage) {
      return JSON.stringify({
        ok: false,
        resid: input.resid,
        error: "NON_IMAGE_RESOURCE",
        mime: resolved.mimeType,
        note: "send_resource 目前只支持图片资源。",
      });
    }

    const fileRef = `base64://${resolved.bytes.toString("base64")}`;
    const result = await this.agentMessageService.sendImage({
      target: chatTarget,
      fileRef,
      replyToMessageId: input.reply_to,
    });

    return JSON.stringify({
      ok: true,
      resid: resolved.resId,
      mime: resolved.mimeType,
      size: resolved.size,
      messageId: result.messageId,
    });
  }
}
