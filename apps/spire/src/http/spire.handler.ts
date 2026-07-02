import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/contract";
import { spireApiContract } from "@kagami/spire-api/contract";
import type { GameAction } from "../engine/engine.js";
import type { SpireService } from "../application/spire.service.js";
import { toScreenView } from "../application/state-view.js";
import { lookupReference } from "../application/reference.js";

// === 尖塔 HTTP 路由 ===
//
// 路由 / schema 的单一事实源是 @kagami/spire-api（#279 PR2）：registerJsonRoute 由契约 output
// 反推 execute 返回类型，服务端改 ScreenView 形状会在这里与 agent 消费端同时编译报错。
// 返回结构化「屏幕视图」（ScreenView），agent 侧据此渲染文字屏幕（渲染逻辑放 agent 侧，
// 服务保持纯游戏后端，issue #234 分工原则）。

export class SpireHandler {
  private readonly service: SpireService;

  public constructor({ service }: { service: SpireService }) {
    this.service = service;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, spireApiContract.startRun, async ({ input }) => {
      const state = await this.service.startRun(input);
      return toScreenView(state, {});
    });

    registerJsonRoute(app, spireApiContract.action, async ({ input }) => {
      const outcome = await this.service.action(input.action as GameAction, input.expectedVersion);
      if (!outcome.ok) {
        return {
          ok: false as const,
          reason: outcome.reason,
          screen: outcome.state ? toScreenView(outcome.state, {}) : null,
        };
      }
      return { ok: true as const, screen: toScreenView(outcome.state, {}) };
    });

    registerJsonRoute(app, spireApiContract.getState, ({ input: _input }) => {
      const state = this.service.getState();
      // GET /state 的 log 恒为空（KV 字节确定性，issue #234 C3）。
      return state ? toScreenView(state, { suppressLog: true }) : null;
    });

    // 卡牌 / 术语参考查询：纯静态数据，不依赖对局状态。
    registerJsonRoute(app, spireApiContract.reference, ({ input }) =>
      lookupReference(input.q ?? ""),
    );
  }
}
