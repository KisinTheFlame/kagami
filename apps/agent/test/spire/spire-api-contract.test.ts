import { createClient } from "@kagami/rpc-client/client";
import { spireApiContract, type SpireScreen } from "@kagami/spire-api/contract";
import { describe, expect, it } from "vitest";

/**
 * 契约编译期强制的「试金石」（#279 PR2，机制同 #230）。断言靠 `tsc --noEmit`（agent typecheck，
 * 经 tsconfig paths 对 @kagami/spire-api **源码**解析）把关：改 SpireScreenSchema 的字段，
 * 下面的类型断言与 @ts-expect-error 会立即失败——此前两端手写同构类型时改服务端不报错的
 * 类型空洞被消灭。vitest 只跑运行时那一行 expect，类型块用 `void (async …)` 包住不执行。
 */
describe("spire-api 契约：编译期类型强制", () => {
  it("createClient 派生的 startRun 返回类型 == 契约 output（SpireScreen）", () => {
    const api = createClient(spireApiContract, { baseUrl: "http://spire" });
    const assertReturnType = (): Promise<SpireScreen> => api.startRun({});
    void assertReturnType;
    expect(typeof api.startRun).toBe("function");
  });

  it("传错 action / 读不存在的 screen 字段 → 编译期报错", () => {
    const api = createClient(spireApiContract, { baseUrl: "http://spire" });
    void (async (): Promise<void> => {
      // @ts-expect-error action.type 只接受三种动作
      await api.action({ action: { type: "cast_spell" } });
      // @ts-expect-error play_card 必须带 handIndex
      await api.action({ action: { type: "play_card" } });
      const screen = await api.startRun({});
      // @ts-expect-error ScreenView 无 nonExistent 字段
      void screen.nonExistent;
      const state = await api.getState({});
      // @ts-expect-error getState 可能为 null，直接取字段必须报错
      void state.version;
    });
    expect(typeof api.action).toBe("function");
  });

  it("action 响应是判别联合：ok:false 才有 reason", () => {
    const api = createClient(spireApiContract, { baseUrl: "http://spire" });
    void (async (): Promise<void> => {
      const response = await api.action({ action: { type: "end_turn" } });
      if (!response.ok) {
        const reason: string = response.reason;
        void reason;
      } else {
        // @ts-expect-error ok:true 分支没有 reason 字段
        void response.reason;
      }
    });
    expect(typeof api.reference).toBe("function");
  });
});
