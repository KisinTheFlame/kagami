import type { FastifyInstance } from "fastify";
import {
  NapcatSendPrivateMessageRequestSchema,
  NapcatSendPrivateMessageResponseSchema,
  NapcatSendGroupMessageRequestSchema,
  NapcatSendGroupMessageResponseSchema,
} from "@kagami/shared/schemas/napcat-message";
import { registerCommandRoute } from "@kagami/http/route";
import { BizError } from "@kagami/kernel/errors/biz-error";

/**
 * 出站发送因禁言被拦时，DefaultAgentMessageService 抛的 MutedSendError（agent 侧类型）。
 * napcat/http 刻意不反向依赖 agent 模块（见 QqMessageSender 结构化定义），故这里按 name
 * 结构识别、翻译成管理台可读的 403，而不 import 那个类。
 */
function isMutedSendError(error: unknown): boolean {
  return error instanceof Error && error.name === "MutedSendError";
}

/**
 * 管理台直发 QQ 消息的最小出站端口。结构化定义，避免 napcat/http 反向依赖 agent 模块——
 * server-runtime 把 QQ App 收口后的 outboundService 传进来即可（形状天然吻合）。
 */
type QqMessageSender = {
  sendGroupMessage(input: { groupId: string; message: string }): Promise<{ messageId: number }>;
  sendPrivateMessage(input: { userId: string; message: string }): Promise<{ messageId: number }>;
};

type NapcatHandlerDeps = {
  qqMessageSender: QqMessageSender;
};

export class NapcatHandler {
  public readonly prefix = "/napcat";
  private readonly qqMessageSender: QqMessageSender;

  public constructor({ qqMessageSender }: NapcatHandlerDeps) {
    this.qqMessageSender = qqMessageSender;
  }

  public register(app: FastifyInstance): void {
    registerCommandRoute({
      app,
      path: `${this.prefix}/group/send`,
      bodySchema: NapcatSendGroupMessageRequestSchema,
      responseSchema: NapcatSendGroupMessageResponseSchema,
      execute: async ({ body }) => {
        try {
          return await this.qqMessageSender.sendGroupMessage({
            groupId: body.groupId,
            message: body.message,
          });
        } catch (error) {
          if (isMutedSendError(error)) {
            throw new BizError({
              message: "该群当前处于禁言状态，无法发送消息。",
              meta: { reason: "GROUP_MUTED" },
              statusCode: 403,
            });
          }
          throw error;
        }
      },
    });

    registerCommandRoute({
      app,
      path: `${this.prefix}/private/send`,
      bodySchema: NapcatSendPrivateMessageRequestSchema,
      responseSchema: NapcatSendPrivateMessageResponseSchema,
      execute: ({ body }) => {
        return this.qqMessageSender.sendPrivateMessage({
          userId: body.userId,
          message: body.message,
        });
      },
    });
  }
}
