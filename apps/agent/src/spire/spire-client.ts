import { SpireError } from "../agent/capabilities/spire/domain/errors.js";

// === 尖塔客户端：把游戏动作经 HTTP 打到独立的 kagami-spire 进程 ===
//
// 服务返回结构化 ScreenView（渲染成文字屏幕的活在 agent 侧 render/）。客户端缓存 lastVersion，
// 每个动作自动带 expectedVersion——HTTP 超时后主 Agent 重发同一动作时服务判为重放、不重复出牌
// （issue #234 B 幂等）。连接失败/超时/坏响应统一映射 SPIRE_NOT_READY。

/** 与服务端 ScreenView 同构（跨包不共享类型，这里独立声明）。 */
export type SpirePower = { id: string; amount: number };

export type SpireIntent = {
  kind: "attack" | "defend" | "buff" | "debuff" | "unknown";
  value?: number;
  hits?: number;
};

export type SpireEnemyView = {
  index: number;
  name: string;
  hp: number;
  maxHp: number;
  block: number;
  powers: SpirePower[];
  intent: SpireIntent;
};

export type SpireHandCardView = {
  index: number;
  name: string;
  cost: number | null;
  type: string;
  targeted: boolean;
  description: string;
};

export type SpireCombatView = {
  turn: number;
  energy: number;
  maxEnergy: number;
  block: number;
  powers: SpirePower[];
  enemies: SpireEnemyView[];
  hand: SpireHandCardView[];
  piles: { draw: number; discard: number; exhaust: number };
};

export type SpireScreen = {
  version: number;
  screen: "map" | "combat" | "reward" | "rest" | "gameover" | "victory";
  player: { hp: number; maxHp: number; gold: number };
  deckCount: number;
  combat: SpireCombatView | null;
  options: string[];
  log: string[];
};

export type SpireAction =
  | { type: "play_card"; handIndex: number; targetIndex?: number | null }
  | { type: "end_turn" }
  | { type: "choose"; optionIndex: number };

/** 参考查询结果（与服务端 ReferenceResult 同构）。 */
export type SpireCardRef = {
  name: string;
  type: string;
  cost: number | null;
  upgradedCost: number | null;
  targeted: boolean;
  description: string;
  upgradedDescription: string;
};
export type SpireGlossaryEntry = { term: string; aliases: string[]; definition: string };
export type SpireReference = {
  query: string;
  cards: SpireCardRef[];
  terms: SpireGlossaryEntry[];
};

export interface SpireClient {
  startRun(): Promise<SpireScreen>;
  act(action: SpireAction): Promise<SpireScreen>;
  getState(): Promise<SpireScreen | null>;
  lookup(query: string): Promise<SpireReference>;
}

type FetchLike = typeof fetch;
type ActionResponse =
  | { ok: true; screen: SpireScreen }
  | { ok: false; reason: string; screen: SpireScreen | null };

const CLIENT_TIMEOUT_MS = 15_000;

export class HttpSpireClient implements SpireClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  /** 最近一次见到的对局版本号；随每个响应更新，作为下一动作的 expectedVersion。 */
  private lastVersion: number | undefined;

  public constructor({ baseUrl, fetch: fetchImpl }: { baseUrl: string; fetch?: FetchLike }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl ?? fetch;
  }

  public async startRun(): Promise<SpireScreen> {
    const screen = (await this.post("/run/start", {})) as SpireScreen;
    this.lastVersion = screen.version;
    return screen;
  }

  public async act(action: SpireAction): Promise<SpireScreen> {
    const response = (await this.post("/run/action", {
      action,
      expectedVersion: this.lastVersion,
    })) as ActionResponse;
    if (!response.ok) {
      // 引擎拒绝（能量不足 / 目标非法等）不是服务故障：带回当前屏幕，作为可读失败让主 Agent 纠正。
      if (response.screen) {
        this.lastVersion = response.screen.version;
      }
      throw new SpireError("SPIRE_REJECTED", response.reason);
    }
    this.lastVersion = response.screen.version;
    return response.screen;
  }

  public async getState(): Promise<SpireScreen | null> {
    const screen = (await this.get("/run/state")) as SpireScreen | null;
    if (screen) {
      this.lastVersion = screen.version;
    }
    return screen;
  }

  public async lookup(query: string): Promise<SpireReference> {
    const path = `/reference?q=${encodeURIComponent(query)}`;
    return (await this.get(path)) as SpireReference;
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    return this.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async get(path: string): Promise<unknown> {
    return this.request(path, { method: "GET" });
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new SpireError(
        "SPIRE_NOT_READY",
        `尖塔服务不可达（未启动 / 半开 / 超时）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      throw new SpireError("SPIRE_NOT_READY", `尖塔服务返回 HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new SpireError("SPIRE_NOT_READY", "尖塔服务返回了无法解析的响应体");
    }
  }
}
