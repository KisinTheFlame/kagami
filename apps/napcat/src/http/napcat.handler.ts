import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { napcatApiContract } from "@kagami/napcat-api/contract";
import type { NapcatGatewayService } from "../application/napcat-gateway.service.js";

type NapcatHandlerDeps = {
  gateway: NapcatGatewayService;
};

/**
 * napcat 服务的出站 RPC handler：把 `@kagami/napcat-api` 契约的 12 个网关方法接到 Fastify。
 * agent 经 HttpNapcatClient 调这些路由。发送类是纯透传——禁言检查目前仍在 agent 侧（发送前
 * 本地 muteStore 检查再调这里），故本层不做 mute 拦截（web 直连 napcat + 禁言态迁移属后续 PR）。
 *
 * console 查询路由（queryNapcatEvents / queryNapcatQqMessages）在契约里已定义，但 console 目前
 * 仍直读共享 SQLite，本服务暂不注册它们（A2 归后续 PR）。
 */
export class NapcatHandler {
  private readonly gateway: NapcatGatewayService;

  public constructor({ gateway }: NapcatHandlerDeps) {
    this.gateway = gateway;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, napcatApiContract.sendGroupMessage, ({ input }) =>
      this.gateway.sendGroupMessage(input),
    );
    registerJsonRoute(app, napcatApiContract.sendPrivateMessage, ({ input }) =>
      this.gateway.sendPrivateMessage(input),
    );
    registerJsonRoute(app, napcatApiContract.sendImage, ({ input }) =>
      this.gateway.sendImage(input),
    );
    registerJsonRoute(app, napcatApiContract.getFriendList, async () => {
      const friends = (await this.gateway.getFriendList?.()) ?? [];
      return { friends };
    });
    registerJsonRoute(app, napcatApiContract.getGroupInfo, ({ input }) =>
      this.gateway.getGroupInfo(input),
    );
    registerJsonRoute(app, napcatApiContract.getRecentGroupMessages, async ({ input }) => {
      const messages = await this.gateway.getRecentGroupMessages(input);
      return { messages };
    });
    registerJsonRoute(app, napcatApiContract.getRecentPrivateMessages, async ({ input }) => {
      const messages = await this.gateway.getRecentPrivateMessages(input);
      return { messages };
    });
    registerJsonRoute(app, napcatApiContract.getForwardMessages, ({ input }) =>
      this.gateway.getForwardMessages(input),
    );
    registerJsonRoute(app, napcatApiContract.listGroupFiles, ({ input }) =>
      this.gateway.listGroupFiles(input),
    );
    registerJsonRoute(app, napcatApiContract.getGroupFileUrl, ({ input }) =>
      this.gateway.getGroupFileUrl(input),
    );
    registerJsonRoute(app, napcatApiContract.getGroupMemberShutUp, async ({ input }) => {
      const shutUpUntilMs = await this.gateway.getGroupMemberShutUp(input);
      return { shutUpUntilMs };
    });
    registerJsonRoute(app, napcatApiContract.uploadGroupFile, async ({ input }) => {
      await this.gateway.uploadGroupFile(input);
      return {};
    });
  }
}
