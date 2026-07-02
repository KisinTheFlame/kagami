import { defineJsonRoute } from "@kagami/http/contract";
import { z } from "zod";

// 游戏接口是轻量 JSON（毫秒级引擎调用），15s 是「服务真挂/半开」的兜底超时，与拆包前
// agent 侧 HttpSpireClient 的 CLIENT_TIMEOUT_MS 一致。
const SPIRE_TIMEOUT_MS = 15_000;

/**
 * kagami-spire 进程对 agent 暴露的 RPC 契约（单一事实源，issue #230 / #274）。
 *
 * ScreenView 及各子结构在这里全类型化：服务端 handler 的 execute 返回类型由 `output` 反推、
 * agent 侧 client 对响应 `output.parse`——改服务端 `toScreenView` 的形状，两端一起编译报错。
 * 此前两端各写一份同构类型（服务端 state-view.ts + agent 侧 spire-client.ts 手写 `as` 断言），
 * HTTP 这一跳是类型空洞。
 *
 * 引擎侧的窄类型（PowerId 等字面量 union）在契约里放宽为 string：视图层只透传展示，
 * 不回流进引擎；服务端返回值是窄类型、可直接赋给宽 schema。
 */
export const SpirePowerSchema = z.object({
  id: z.string(),
  amount: z.number().int(),
});

export const SpireIntentSchema = z.object({
  kind: z.enum(["attack", "defend", "buff", "debuff", "unknown"]),
  value: z.number().int().optional(),
  hits: z.number().int().optional(),
});

export const SpireEnemyViewSchema = z.object({
  index: z.number().int(),
  name: z.string(),
  hp: z.number().int(),
  maxHp: z.number().int(),
  block: z.number().int(),
  powers: z.array(SpirePowerSchema),
  intent: SpireIntentSchema,
});

export const SpireHandCardViewSchema = z.object({
  index: z.number().int(),
  name: z.string(),
  cost: z.number().int().nullable(),
  type: z.string(),
  targeted: z.boolean(),
  description: z.string(),
});

export const SpireCombatViewSchema = z.object({
  turn: z.number().int(),
  energy: z.number().int(),
  maxEnergy: z.number().int(),
  block: z.number().int(),
  powers: z.array(SpirePowerSchema),
  enemies: z.array(SpireEnemyViewSchema),
  hand: z.array(SpireHandCardViewSchema),
  piles: z.object({
    draw: z.number().int(),
    discard: z.number().int(),
    exhaust: z.number().int(),
  }),
});

export const SpireRelicViewSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const SpireScreenSchema = z.object({
  version: z.number().int(),
  screen: z.enum(["map", "combat", "reward", "rest", "gameover", "victory"]),
  player: z.object({
    hp: z.number().int(),
    maxHp: z.number().int(),
    gold: z.number().int(),
  }),
  deckCount: z.number().int(),
  relics: z.array(SpireRelicViewSchema),
  combat: SpireCombatViewSchema.nullable(),
  options: z.array(z.string()),
  log: z.array(z.string()),
});

export const SpireActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("play_card"),
    handIndex: z.number().int().min(0),
    targetIndex: z.number().int().min(0).nullish(),
  }),
  z.object({ type: z.literal("end_turn") }),
  z.object({ type: z.literal("choose"), optionIndex: z.number().int().min(0) }),
]);

/** 动作结果：引擎拒绝（能量不足 / 目标非法等）不是服务故障，带回当前屏幕作可读失败。 */
export const SpireActionResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), screen: SpireScreenSchema }),
  z.object({ ok: z.literal(false), reason: z.string(), screen: SpireScreenSchema.nullable() }),
]);

export const SpireCardRefSchema = z.object({
  name: z.string(),
  type: z.string(),
  cost: z.number().int().nullable(),
  upgradedCost: z.number().int().nullable(),
  targeted: z.boolean(),
  description: z.string(),
  upgradedDescription: z.string(),
});

export const SpireGlossaryEntrySchema = z.object({
  term: z.string(),
  aliases: z.array(z.string()),
  definition: z.string(),
});

export const SpireReferenceSchema = z.object({
  query: z.string(),
  cards: z.array(SpireCardRefSchema),
  terms: z.array(SpireGlossaryEntrySchema),
});

export const spireApiContract = {
  startRun: defineJsonRoute({
    method: "POST",
    path: "/run/start",
    input: z.object({
      seed: z.number().int().optional(),
      character: z.literal("ironclad").optional(),
      ascension: z.number().int().min(0).optional(),
    }),
    output: SpireScreenSchema,
    timeoutMs: SPIRE_TIMEOUT_MS,
  }),
  action: defineJsonRoute({
    method: "POST",
    path: "/run/action",
    input: z.object({
      expectedVersion: z.number().int().optional(),
      action: SpireActionSchema,
    }),
    output: SpireActionResponseSchema,
    timeoutMs: SPIRE_TIMEOUT_MS,
  }),
  state: defineJsonRoute({
    method: "GET",
    path: "/run/state",
    input: z.object({}),
    // 无对局时为 null（GET /state 的 log 恒为空，KV 字节确定性见服务端 handler）。
    output: SpireScreenSchema.nullable(),
    timeoutMs: SPIRE_TIMEOUT_MS,
  }),
  reference: defineJsonRoute({
    method: "GET",
    path: "/reference",
    input: z.object({ q: z.string().optional() }),
    output: SpireReferenceSchema,
    timeoutMs: SPIRE_TIMEOUT_MS,
  }),
};
