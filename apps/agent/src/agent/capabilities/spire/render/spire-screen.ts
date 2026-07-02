import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import type {
  SpireEnemyView,
  SpireHandCardView,
  SpirePower,
  SpireScreen,
} from "../../../../spire/spire-client.js";

// === ScreenView → 文字屏幕（走 .hbs 模板）===
//
// 渲染放 agent 侧（分工原则，issue #234）：调屏幕文案不用重部署游戏服务。
// TS 只算 view-model（数字 / 数组 / 布尔 flag / 结构标识符）；所有成句文案在
// apps/agent/static/context/spire-screen.hbs（AGENTS.md:92 红线）。
//
// 结构标识符（power / 意图 / 卡类型的短标签，等同 "QQ"/"待办"）留 TS 常量，非语气文案。

const POWER_LABELS: Record<string, string> = {
  strength: "力量",
  vulnerable: "易伤",
  weak: "虚弱",
  ritual: "仪式",
  curl_up: "蜷缩",
  mode_shift: "模式",
};

function labelPowers(powers: readonly SpirePower[]): { label: string; amount: number }[] {
  return powers.map(power => ({ label: POWER_LABELS[power.id] ?? power.id, amount: power.amount }));
}

function enemyView(enemy: SpireEnemyView): Record<string, unknown> {
  const intent = enemy.intent;
  return {
    n: enemy.index + 1,
    name: enemy.name,
    hp: enemy.hp,
    maxHp: enemy.maxHp,
    block: enemy.block,
    hasBlock: enemy.block > 0,
    powers: labelPowers(enemy.powers),
    hasPowers: enemy.powers.length > 0,
    isAttack: intent.kind === "attack",
    isDefend: intent.kind === "defend",
    isBuff: intent.kind === "buff",
    isDebuff: intent.kind === "debuff",
    isUnknown: intent.kind === "unknown",
    intentValue: intent.value ?? 0,
    intentHits: intent.hits ?? 1,
    isMultiHit: (intent.hits ?? 1) > 1,
  };
}

function handView(card: SpireHandCardView): Record<string, unknown> {
  return {
    n: card.index + 1,
    name: card.name,
    playable: card.cost !== null,
    cost: card.cost ?? 0,
    targeted: card.targeted,
    description: card.description,
  };
}

export function renderSpireScreen(screen: SpireScreen): string {
  const combat = screen.combat;
  return renderServerStaticTemplate(import.meta.url, "context/spire-screen.hbs", {
    isCombat: screen.screen === "combat",
    isReward: screen.screen === "reward",
    isRest: screen.screen === "rest",
    isGameover: screen.screen === "gameover",
    isVictory: screen.screen === "victory",
    hp: screen.player.hp,
    maxHp: screen.player.maxHp,
    deckCount: screen.deckCount,
    combat: combat
      ? {
          turn: combat.turn,
          energy: combat.energy,
          maxEnergy: combat.maxEnergy,
          block: combat.block,
          hasBlock: combat.block > 0,
          powers: labelPowers(combat.powers),
          hasPowers: combat.powers.length > 0,
          enemies: combat.enemies.map(enemyView),
          hand: combat.hand.map(handView),
          draw: combat.piles.draw,
          discard: combat.piles.discard,
          exhaust: combat.piles.exhaust,
        }
      : null,
    options: screen.options.map((text, index) => ({ n: index, text })),
    hasOptions: screen.options.length > 0,
    logLines: screen.log,
    hasLog: screen.log.length > 0,
  });
}

/** 服务不可达时的降级屏（错误已被工具基类序列化，这里只在 onFocus 等处兜底用）。 */
export function renderSpireUnavailable(): string {
  return renderServerStaticTemplate(import.meta.url, "context/spire-unavailable.hbs", {});
}

/** 没有进行中对局时的提示屏（look 拿到 null 时用）。 */
export function renderSpireNoRun(): string {
  return renderServerStaticTemplate(import.meta.url, "context/spire-no-run.hbs", {});
}

/** 进入尖塔 App 的静态提示屏（onFocus / help 用，无网络 I/O）。 */
export function renderSpirePortal(): string {
  return renderServerStaticTemplate(import.meta.url, "context/spire-portal.hbs", {});
}
