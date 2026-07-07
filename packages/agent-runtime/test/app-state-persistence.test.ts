import { describe, expect, it, vi } from "vitest";
import { AppManager, type App, type AppStateStore, type JsonValue } from "../src/app/app.js";

class FakeStore implements AppStateStore {
  public readonly saved = new Map<string, JsonValue>();
  public constructor(private readonly initial: Map<string, JsonValue> = new Map()) {}
  public async load(appId: string): Promise<JsonValue | null> {
    return this.initial.get(appId) ?? null;
  }
  public async save(appId: string, state: JsonValue): Promise<void> {
    this.saved.set(appId, state);
  }
}

function makeApp(id: string, opts: Partial<App> = {}): App {
  return {
    id,
    displayName: id,
    description: id,
    tools: [],
    canInvoke: () => true,
    help: async () => "",
    ...opts,
  };
}

describe("AppManager — App 状态持久化编排", () => {
  it("启动时先 restoreState 再 onStartup，关停时 exportState 存进 store", async () => {
    const order: string[] = [];
    const store = new FakeStore(new Map<string, JsonValue>([["a", { v: 1, badge: 7 }]]));
    const restoreState = vi.fn((_s: JsonValue) => {
      order.push("restore");
    });
    const exportState = vi.fn((): JsonValue => ({ badge: 9 }));
    const onStartup = vi.fn(async () => {
      order.push("startup");
    });
    const onShutdown = vi.fn(async () => {
      order.push("shutdown");
    });
    const manager = new AppManager({ stateStore: store });
    manager.register(makeApp("a", { restoreState, exportState, onStartup, onShutdown }));

    await manager.startupAll();
    expect(restoreState).toHaveBeenCalledWith({ v: 1, badge: 7 });
    expect(order).toEqual(["restore", "startup"]); // 恢复先于启动

    await manager.shutdownAll();
    expect(store.saved.get("a")).toEqual({ badge: 9 });
    // 关停：先抓状态（App 仍活）再 onShutdown
    expect(exportState.mock.invocationCallOrder[0]).toBeLessThan(
      onShutdown.mock.invocationCallOrder[0],
    );
  });

  it("无存档时不调 restoreState；无 exportState 的 App 不写库", async () => {
    const store = new FakeStore();
    const restoreState = vi.fn();
    const manager = new AppManager({ stateStore: store });
    manager.register(makeApp("a", { restoreState }));

    await manager.startupAll();
    expect(restoreState).not.toHaveBeenCalled(); // load 返回 null

    await manager.shutdownAll();
    expect(store.saved.size).toBe(0); // App 没有 exportState
  });

  it("没注入 store 时持久化整体 no-op，不报错", async () => {
    const exportState = vi.fn((): JsonValue => ({}));
    const restoreState = vi.fn();
    const manager = new AppManager();
    manager.register(makeApp("a", { exportState, restoreState }));

    await manager.startupAll();
    await manager.shutdownAll();
    expect(restoreState).not.toHaveBeenCalled();
    expect(exportState).not.toHaveBeenCalled();
  });

  it("restore 失败不阻断启动，但上报 onStateError（phase=restore）", async () => {
    const boom = new Error("boom");
    const store: AppStateStore = {
      load: vi.fn(async () => {
        throw boom;
      }),
      save: vi.fn(async () => {}),
    };
    const onStartup = vi.fn(async () => {});
    const onStateError = vi.fn();
    const manager = new AppManager({ stateStore: store, onStateError });
    manager.register(makeApp("a", { restoreState: vi.fn(), onStartup }));

    await manager.startupAll();
    expect(onStartup).toHaveBeenCalledTimes(1); // 启动照常进行
    // 失败不再静默：上报给宿主
    expect(onStateError).toHaveBeenCalledWith({ appId: "a", phase: "restore", error: boom });
  });

  it("persist 失败不阻断关停，但上报 onStateError（phase=persist）", async () => {
    const boom = new Error("save failed");
    const store: AppStateStore = {
      load: vi.fn(async () => null),
      save: vi.fn(async () => {
        throw boom;
      }),
    };
    const onShutdown = vi.fn(async () => {});
    const onStateError = vi.fn();
    const manager = new AppManager({ stateStore: store, onStateError });
    manager.register(makeApp("a", { exportState: () => ({ badge: 9 }), onShutdown }));

    await manager.startupAll();
    await manager.shutdownAll();
    expect(onShutdown).toHaveBeenCalledTimes(1); // 关停照常收尾
    expect(onStateError).toHaveBeenCalledWith({ appId: "a", phase: "persist", error: boom });
  });

  it("没注入 onStateError 时失败仍被吞（不抛），保持向后兼容", async () => {
    const store: AppStateStore = {
      load: vi.fn(async () => {
        throw new Error("boom");
      }),
      save: vi.fn(async () => {}),
    };
    const manager = new AppManager({ stateStore: store });
    manager.register(makeApp("a", { restoreState: vi.fn() }));
    // 不注入 onStateError：startupAll 不应抛
    await expect(manager.startupAll()).resolves.toBeUndefined();
  });
});
