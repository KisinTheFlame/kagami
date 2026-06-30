import type { FastifyInstance } from "fastify";
import {
  NapcatSendPrivateMessageRequestSchema,
  NapcatSendPrivateMessageResponseSchema,
  NapcatSendGroupMessageRequestSchema,
  NapcatSendGroupMessageResponseSchema,
} from "@kagami/shared/schemas/napcat-message";
import { registerCommandRoute } from "@kagami/http/route";

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
      execute: ({ body }) => {
        return this.qqMessageSender.sendGroupMessage({
          groupId: body.groupId,
          message: body.message,
        });
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
