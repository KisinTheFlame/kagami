import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { registerCommandRoute, registerQueryRoute } from "@kagami/http/route";
import type { GameAction } from "../engine/engine.js";
import type { SpireService } from "../application/spire.service.js";
import { toScreenView } from "../application/state-view.js";
import { lookupReference } from "../application/reference.js";

// === 尖塔 HTTP 路由 ===
//
// 返回结构化「屏幕视图」（ScreenView），agent 侧据此渲染文字屏幕（渲染逻辑放 agent 侧，
// 服务保持纯游戏后端，issue #234 分工原则）。响应体走 z.unknown() 透传（localhost 内部 RPC）。

const StartBodySchema = z.object({
  seed: z.number().int().optional(),
  character: z.literal("ironclad").optional(),
  ascension: z.number().int().min(0).optional(),
});

const ActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("play_card"),
    handIndex: z.number().int().min(0),
    targetIndex: z.number().int().min(0).nullish(),
  }),
  z.object({ type: z.literal("end_turn") }),
  z.object({
    type: z.literal("use_potion"),
    slotIndex: z.number().int().min(0),
    targetIndex: z.number().int().min(0).nullish(),
  }),
  z.object({ type: z.literal("choose"), optionIndex: z.number().int().min(0) }),
]);

const ActionBodySchema = z.object({
  expectedVersion: z.number().int().optional(),
  action: ActionSchema,
});

const StateQuerySchema = z.object({});
const ReferenceQuerySchema = z.object({ q: z.string().optional() });
const ResponseSchema = z.unknown();

export class SpireHandler {
  private readonly service: SpireService;

  public constructor({ service }: { service: SpireService }) {
    this.service = service;
  }

  public register(app: FastifyInstance): void {
    registerCommandRoute({
      app,
      path: "/run/start",
      bodySchema: StartBodySchema,
      responseSchema: ResponseSchema,
      execute: async ({ body }) => {
        const state = await this.service.startRun(body);
        return toScreenView(state, {});
      },
    });

    registerCommandRoute({
      app,
      path: "/run/action",
      bodySchema: ActionBodySchema,
      responseSchema: ResponseSchema,
      execute: async ({ body }) => {
        const outcome = await this.service.action(body.action as GameAction, body.expectedVersion);
        if (!outcome.ok) {
          return {
            ok: false,
            reason: outcome.reason,
            screen: outcome.state ? toScreenView(outcome.state, {}) : null,
          };
        }
        return { ok: true, screen: toScreenView(outcome.state, {}) };
      },
    });

    registerQueryRoute({
      app,
      path: "/run/state",
      querySchema: StateQuerySchema,
      responseSchema: ResponseSchema,
      execute: () => {
        const state = this.service.getState();
        // GET /state 的 log 恒为空（KV 字节确定性，issue #234 C3）。
        return state ? toScreenView(state, { suppressLog: true }) : null;
      },
    });

    // 卡牌 / 术语参考查询：纯静态数据，不依赖对局状态。
    registerQueryRoute({
      app,
      path: "/reference",
      querySchema: ReferenceQuerySchema,
      responseSchema: ResponseSchema,
      execute: ({ query }) => lookupReference(query.q ?? ""),
    });
  }
}
