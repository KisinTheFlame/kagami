import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { agentApiContract } from "@kagami/agent-api/contract";
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

    registerJsonRoute(app, agentApiContract.sendPrivateMessage, ({ input }) =>
      this.qqMessageSender.sendPrivateMessage({
        userId: input.userId,
        message: input.message,
      }),
    );
  }
}
