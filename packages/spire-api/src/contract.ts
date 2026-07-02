import { defineJsonRoute } from "@kagami/http/contract";
import { z } from "zod";

// === @kagami/spire-api：kagami-spire 服务的 HTTP 契约（issue #279 PR2，收编 #274 对应项） ===
//
// 服务端 registerJsonRoute(contract) 反推 execute 返回类型；agent 侧门面类型全部由 z.infer
// 派生（门面==契约，#230 强制机制）。此前两端各自手写同构类型 + z.unknown() 透传，改服务端
// ScreenView 字段 agent 不会编译报错——本包消灭该类型空洞。

export const SpirePowerSchema = z.object({
  /** 能力 id（服务端是 PowerId 字面量联合；wire 层收窄为 string，渲染只需要展示）。 */
  id: z.string(),
  amount: z.number(),
});

export const SpireIntentSchema = z.object({
  kind: z.enum(["attack", "defend", "buff", "debuff", "unknown"]),
  value: z.number().optional(),
  hits: z.number().optional(),
});

export const SpireEnemyViewSchema = z.object({
  index: z.number(),
  name: z.string(),
  hp: z.number(),
  maxHp: z.number(),
  block: z.number(),
  powers: z.array(SpirePowerSchema),
  intent: SpireIntentSchema,
});

export const SpireHandCardViewSchema = z.object({
  index: z.number(),
  name: z.string(),
  cost: z.number().nullable(),
  type: z.string(),
  targeted: z.boolean(),
  description: z.string(),
});

export const SpireCombatViewSchema = z.object({
  turn: z.number(),
  energy: z.number(),
  maxEnergy: z.number(),
  block: z.number(),
  powers: z.array(SpirePowerSchema),
  enemies: z.array(SpireEnemyViewSchema),
  hand: z.array(SpireHandCardViewSchema),
  piles: z.object({ draw: z.number(), discard: z.number(), exhaust: z.number() }),
});

export const SpireRelicViewSchema = z.object({ name: z.string(), description: z.string() });

export const SpireScreenSchema = z.object({
  version: z.number(),
  screen: z.enum(["map", "combat", "reward", "rest", "gameover", "victory"]),
  player: z.object({ hp: z.number(), maxHp: z.number(), gold: z.number() }),
  deckCount: z.number(),
  relics: z.array(SpireRelicViewSchema),
  combat: SpireCombatViewSchema.nullable(),
  options: z.array(z.string()),
  log: z.array(z.string()),
});

export type SpirePower = z.infer<typeof SpirePowerSchema>;
export type SpireIntent = z.infer<typeof SpireIntentSchema>;
export type SpireEnemyView = z.infer<typeof SpireEnemyViewSchema>;
export type SpireHandCardView = z.infer<typeof SpireHandCardViewSchema>;
export type SpireCombatView = z.infer<typeof SpireCombatViewSchema>;
export type SpireRelicView = z.infer<typeof SpireRelicViewSchema>;
export type SpireScreen = z.infer<typeof SpireScreenSchema>;

export const SpireActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("play_card"),
    handIndex: z.number().int().min(0),
    targetIndex: z.number().int().min(0).nullish(),
  }),
  z.object({ type: z.literal("end_turn") }),
  z.object({ type: z.literal("choose"), optionIndex: z.number().int().min(0) }),
]);

export type SpireAction = z.infer<typeof SpireActionSchema>;

export const SpireStartRunRequestSchema = z.object({
  seed: z.number().int().optional(),
  character: z.literal("ironclad").optional(),
  ascension: z.number().int().min(0).optional(),
});

export const SpireActionRequestSchema = z.object({
  /** 幂等 / 乐观并发：HTTP 超时重发同一动作时服务判重放，不重复出牌（#234 B）。 */
  expectedVersion: z.number().int().optional(),
  action: SpireActionSchema,
});

export const SpireActionResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), screen: SpireScreenSchema }),
  /** 引擎拒绝（能量不足 / 目标非法等）：不是服务故障，带回当前屏幕供主 Agent 纠正。 */
  z.object({ ok: z.literal(false), reason: z.string(), screen: SpireScreenSchema.nullable() }),
]);

export type SpireActionResponse = z.infer<typeof SpireActionResponseSchema>;

export const SpireCardRefSchema = z.object({
  name: z.string(),
  type: z.string(),
  cost: z.number().nullable(),
  upgradedCost: z.number().nullable(),
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

export type SpireCardRef = z.infer<typeof SpireCardRefSchema>;
export type SpireGlossaryEntry = z.infer<typeof SpireGlossaryEntrySchema>;
export type SpireReference = z.infer<typeof SpireReferenceSchema>;

export const spireApiContract = {
  startRun: defineJsonRoute({
    method: "POST",
    path: "/run/start",
    input: SpireStartRunRequestSchema,
    output: SpireScreenSchema,
  }),
  action: defineJsonRoute({
    method: "POST",
    path: "/run/action",
    input: SpireActionRequestSchema,
    output: SpireActionResponseSchema,
  }),
  getState: defineJsonRoute({
    method: "GET",
    path: "/run/state",
    input: z.object({}),
    output: SpireScreenSchema.nullable(),
  }),
  reference: defineJsonRoute({
    method: "GET",
    path: "/reference",
    input: z.object({ q: z.string().optional() }),
    output: SpireReferenceSchema,
  }),
} as const;
