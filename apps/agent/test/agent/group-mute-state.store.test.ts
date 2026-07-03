import { describe, expect, it } from "vitest";
import { GroupMuteStateStore } from "../../src/agent/capabilities/messaging/application/group-mute-state.store.js";

function storeAt(start = 1_000_000) {
  let now = start;
  const store = new GroupMuteStateStore({ now: () => now });
  return {
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("GroupMuteStateStore", () => {
  it("self 禁言在到期前 check 命中，带到期时间戳", () => {
    const { store } = storeAt();
    store.setSelfMute("g1", 1_600_000);
    expect(store.check("g1")).toEqual({ muted: true, reason: "self", untilEpochMs: 1_600_000 });
  });

  it("self 禁言 check 时惰性过期：到点后返回未禁言", () => {
    const { store, advance } = storeAt();
    store.setSelfMute("g1", 1_100_000);
    advance(200_000); // 越过到期
    expect(store.check("g1")).toEqual({ muted: false });
    // 已惰性清除：再 check 仍未禁言。
    expect(store.check("g1")).toEqual({ muted: false });
  });

  it("setSelfMute 的到期时间不在未来时等价于清除", () => {
    const { store } = storeAt();
    store.setSelfMute("g1", 500_000); // 已是过去
    expect(store.check("g1")).toEqual({ muted: false });
  });

  it("clearSelfMute 立即解除 self 禁言", () => {
    const { store } = storeAt();
    store.setSelfMute("g1", 1_600_000);
    store.clearSelfMute("g1");
    expect(store.check("g1")).toEqual({ muted: false });
  });

  it("setWholeGroupMute 开 / 关切换", () => {
    const { store } = storeAt();
    store.setWholeGroupMute("g1", true);
    expect(store.check("g1")).toEqual({ muted: true, reason: "whole" });
    store.setWholeGroupMute("g1", false);
    expect(store.check("g1")).toEqual({ muted: false });
  });

  describe("组合态（self 与 whole 独立，同真优先 self）", () => {
    it("同时 self + whole → 优先报 self（信息更多）", () => {
      const { store } = storeAt();
      store.setSelfMute("g1", 1_600_000);
      store.setWholeGroupMute("g1", true);
      expect(store.check("g1")).toEqual({ muted: true, reason: "self", untilEpochMs: 1_600_000 });
    });

    it("lift(self) 不清 whole", () => {
      const { store } = storeAt();
      store.setSelfMute("g1", 1_600_000);
      store.setWholeGroupMute("g1", true);
      store.clearSelfMute("g1");
      expect(store.check("g1")).toEqual({ muted: true, reason: "whole" });
    });

    it("lift(whole) 不清 self", () => {
      const { store } = storeAt();
      store.setSelfMute("g1", 1_600_000);
      store.setWholeGroupMute("g1", true);
      store.setWholeGroupMute("g1", false);
      expect(store.check("g1")).toEqual({ muted: true, reason: "self", untilEpochMs: 1_600_000 });
    });

    it("self 惰性过期只清 self，whole 保留", () => {
      const { store, advance } = storeAt();
      store.setSelfMute("g1", 1_100_000);
      store.setWholeGroupMute("g1", true);
      advance(200_000);
      expect(store.check("g1")).toEqual({ muted: true, reason: "whole" });
    });
  });

  it("不同群互不影响", () => {
    const { store } = storeAt();
    store.setSelfMute("g1", 1_600_000);
    expect(store.check("g2")).toEqual({ muted: false });
  });
});
