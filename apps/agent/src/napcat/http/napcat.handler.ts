import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { agentApiContract } from "@kagami/agent-api/contract";

/**
 * 管理台直发 QQ 消息的最小出站端口。结构化定义，避免 napcat/http 反向依赖 agent 模块——
 * server-runtime 把 QQ App 收口后的 outboundService 传进来即可（形状天然吻合）。
 * 路由与 schema 的单一事实源在 @kagami/agent-api（#279 PR5）。
 */
type QqMessageSender = {
  sendGroupMessage(input: { groupId: string; message: string }): Promise<{ messageId: number }>;
  sendPrivateMessage(input: { userId: string; message: string }): Promise<{ messageId: number }>;
};

type NapcatHandlerDeps = {
  qqMessageSender: QqMessageSender;
};

export class NapcatHandler {
  private readonly qqMessageSender: QqMessageSender;

  public constructor({ qqMessageSender }: NapcatHandlerDeps) {
    this.qqMessageSender = qqMessageSender;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, agentApiContract.sendGroupMessage, ({ input }) =>
      this.qqMessageSender.sendGroupMessage({
        groupId: input.groupId,
        message: input.message,
      }),
    );

    registerJsonRoute(app, agentApiContract.sendPrivateMessage, ({ input }) =>
      this.qqMessageSender.sendPrivateMessage({
        userId: input.userId,
        message: input.message,
      }),
    );
  }
}
