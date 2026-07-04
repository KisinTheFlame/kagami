import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { agentApiContract } from "@kagami/agent-api/contract";
import { BizError } from "@kagami/kernel/errors/biz-error";

/**
 * 管理台直发 QQ 消息的出站端口（agent 侧）。napcat 拆成独立进程后（issue #347），本 handler 仍
 * 留在 agent：web/管理台经 gateway → agent → outboundService（禁言检查在这里）→ HttpNapcatClient
 * → kagami-napcat。web 直连 napcat + 禁言态迁移属后续 PR（A2/B），本 PR 保持 agent 代理。
 *
 * 结构化定义 QqMessageSender，避免 http 层反向依赖具体发送实现——server-runtime 把 QQ App 收口后
 * 的 outboundService 传进来即可（形状天然吻合）。路由 / schema 单一事实源在 @kagami/agent-api。
 */
function isMutedSendError(error: unknown): boolean {
  return error instanceof Error && error.name === "MutedSendError";
}

type QqMessageSender = {
  sendGroupMessage(input: { groupId: string; message: string }): Promise<{ messageId: number }>;
  sendPrivateMessage(input: { userId: string; message: string }): Promise<{ messageId: number }>;
};

type QqMessageHandlerDeps = {
  qqMessageSender: QqMessageSender;
};

export class QqMessageHandler {
  private readonly qqMessageSender: QqMessageSender;

  public constructor({ qqMessageSender }: QqMessageHandlerDeps) {
    this.qqMessageSender = qqMessageSender;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, agentApiContract.sendGroupMessage, async ({ input }) => {
      try {
        return await this.qqMessageSender.sendGroupMessage({
          groupId: input.groupId,
          message: input.message,
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
    });

    registerJsonRoute(app, agentApiContract.sendPrivateMessage, async ({ input }) => {
      return await this.qqMessageSender.sendPrivateMessage({
        userId: input.userId,
        message: input.message,
      });
    });
  }
}
