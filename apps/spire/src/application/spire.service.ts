import { randomUUID } from "node:crypto";
import type { CharacterId, GameState } from "../engine/types.js";
import { applyAction, newRun, type GameAction } from "../engine/engine.js";
import { SaveStore } from "../persistence/save-store.js";

// === 尖塔游戏服务（application）===
//
// 持有内存中的当前对局（单人单局）+ SaveStore。动作串行处理（mutex），带 expectedVersion
// 幂等：HTTP 超时重放同一动作不会重复出牌（issue #234 B）。

export type ActionOutcome =
  | { ok: true; state: GameState }
  | { ok: false; reason: string; state: GameState | null };

export class SpireService {
  private readonly store: SaveStore;
  private current: GameState | null = null;
  /** 串行队列：动作 apply + 存档不与其它请求交错。 */
  private tail: Promise<unknown> = Promise.resolve();

  public constructor({ store }: { store: SaveStore }) {
    this.store = store;
  }

  /** 启动时从存档恢复内存态；无 / 损坏存档则留空（等 start_run）。 */
  public async init(): Promise<void> {
    this.current = await this.store.load();
  }

  public getState(): GameState | null {
    return this.current;
  }

  public async startRun(input: {
    seed?: number;
    character?: CharacterId;
    ascension?: number;
  }): Promise<GameState> {
    return this.serialize(async () => {
      const seed = input.seed ?? Math.floor(Math.random() * 0x7fffffff) + 1;
      const state = newRun({
        runId: randomUUID(),
        seed,
        character: input.character,
        ascension: input.ascension,
      });
      state.version = 1;
      // 先落盘再 commit 内存：写盘失败则 this.current 不变，内存与磁盘不分叉。
      await this.store.save(state);
      this.current = state;
      return state;
    });
  }

  /**
   * 执行一个动作。expectedVersion 是**乐观并发前置条件**（不是幂等重放键）：
   * 与当前版本不符一律**响亮拒绝**并回当前屏幕，让主 Agent 先 look 再决定——绝不把
   * 版本落后的请求静默当作重放而吞掉一个合法新动作（评审 #1）。这样保留了「同一动作
   * 超时重发不会重复出牌」（被拒后 look 到已应用的结果），又不会静默丢动作。
   */
  public async action(action: GameAction, expectedVersion?: number): Promise<ActionOutcome> {
    return this.serialize(async () => {
      const state = this.current;
      if (!state) {
        return { ok: false, reason: "还没有对局，先 start_run。", state: null };
      }
      if (expectedVersion !== undefined && expectedVersion !== state.version) {
        return {
          ok: false,
          reason: `对局已推进到 v${state.version}（你带的是 v${expectedVersion}）。先 look 查看最新战况再决定动作。`,
          state,
        };
      }
      // 在副本上结算、落盘成功后再 commit：写盘失败则内存态保持动作前，内存与磁盘一致（评审 #2）。
      const next = structuredClone(state);
      const result = applyAction(next, action);
      if (!result.ok) {
        return { ok: false, reason: result.reason, state };
      }
      next.version += 1;
      await this.store.save(next);
      this.current = next;
      return { ok: true, state: next };
    });
  }

  /** 把任务挂到队尾串行执行。 */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    // tail 只用来排队，吞掉结果与异常，避免一次失败卡死整条链。
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
