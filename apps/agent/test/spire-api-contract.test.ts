import { createClient } from "@kagami/rpc-client/client";
import { spireApiContract, type SpireScreenSchema } from "@kagami/spire-api/contract";
import type { z } from "zod";
import { describe, expect, it } from "vitest";

type SpireScreen = z.infer<typeof SpireScreenSchema>;

/**
 * 契约编译期强制的「试金石」（issue #230 / #274）。这些断言主要靠 `tsc --noEmit`（agent
 * typecheck，经 tsconfig paths 对 @kagami/spire-api **源码**解析）把关：改 spireApiContract
 * 的 output，下面的类型断言与 @ts-expect-error 会立即失败——证明「上游改契约、下游编译报错」。
 * vitest 只跑运行时那一行 expect，类型块用 `void (async …)` 包住不执行。
 */
describe("spire-api 契约：编译期类型强制", () => {
  it("createClient 派生的 startRun 返回类型 == 契约 output（SpireScreen）", () => {
    const api = createClient(spireApiContract, { baseUrl: "http://spire" });
    // 门面 == 契约：返回类型必须精确赋给 Promise<SpireScreen>，否则编译失败。
    const assertReturnType = (): Promise<SpireScreen> => api.startRun({});
    void assertReturnType;
    expect(typeof api.startRun).toBe("function");
  });

  it("传错 input / 读不存在的 output 字段 → 编译期报错", () => {
    const api = createClient(spireApiContract, { baseUrl: "http://spire" });
    void (async (): Promise<void> => {
      // @ts-expect-error action 是必填的判别联合，缺失必须报错
      await api.action({});
      // @ts-expect-error play_card 必须带 handIndex
      await api.action({ action: { type: "play_card" } });
      // @ts-expect-error 契约 action 联合里没有 undo 这个动作
      await api.action({ action: { type: "undo" } });
      const screen = await api.startRun({});
      // @ts-expect-error ScreenView 无 nonExistent 字段
      void screen.nonExistent;
      // combat 是 nullable：不判空直接取字段必须报错
      // @ts-expect-error combat 可能为 null
      void screen.combat.energy;
      const state = await api.state({});
      // @ts-expect-error state 可能为 null（无对局）
      void state.version;
      const reference = await api.reference({ q: "打击" });
      void reference.cards[0]?.upgradedDescription;
    });
    expect(typeof api.action).toBe("function");
  });
});
