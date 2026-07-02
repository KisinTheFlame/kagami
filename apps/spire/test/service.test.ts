import { describe, expect, it } from "vitest";
import { SpireService } from "../src/application/spire.service.js";
import type { SaveStore } from "../src/persistence/save-store.js";
import type { GameState } from "../src/engine/types.js";

// 用假存档验证服务层的乐观并发（评审 #1）与 clone-apply-save-commit（评审 #2）。

class FakeStore {
  public saved: GameState[] = [];
  public failNext = false;
  public async load(): Promise<GameState | null> {
    return null;
  }
  public async save(state: GameState): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("disk full");
    }
    this.saved.push(structuredClone(state));
  }
}

function makeService(store: FakeStore): SpireService {
  return new SpireService({ store: store as unknown as SaveStore });
}

describe("SpireService 并发与持久化", () => {
  it("start_run 落盘成功后 version=1", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    const state = await service.startRun({ seed: 1 });
    expect(state.version).toBe(1);
    expect(store.saved.at(-1)?.version).toBe(1);
  });

  it("expectedVersion 不匹配一律响亮拒绝、不静默吞动作", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    await service.startRun({ seed: 1 });
    const outcome = await service.action({ type: "choose", optionIndex: 0 }, 0); // 带过期版本 0，当前是 1
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain("look");
    }
    // 状态未推进。
    expect(service.getState()?.version).toBe(1);
  });

  it("正确 expectedVersion 应用动作并 +1", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    await service.startRun({ seed: 1 });
    const outcome = await service.action({ type: "choose", optionIndex: 0 }, 1);
    expect(outcome.ok).toBe(true);
    expect(service.getState()?.version).toBe(2);
  });

  it("写盘失败时内存态回滚到动作前，与磁盘不分叉", async () => {
    const store = new FakeStore();
    const service = makeService(store);
    await service.startRun({ seed: 1 });
    const before = structuredClone(service.getState()!);
    store.failNext = true;
    await expect(service.action({ type: "choose", optionIndex: 0 }, 1)).rejects.toThrow();
    // 内存 version 仍为动作前，磁盘最后一次成功存档也是 v1。
    expect(service.getState()?.version).toBe(before.version);
    expect(store.saved.at(-1)?.version).toBe(1);
  });
});
