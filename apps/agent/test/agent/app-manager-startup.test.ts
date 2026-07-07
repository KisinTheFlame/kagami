import { AppManager, type App, type AppStartupContext } from "@kagami/agent-runtime";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const CalcLikeConfigSchema = z
  .object({
    precision: z.number().int().min(0).max(20).optional(),
  })
  .default({});

type CalcLikeConfig = z.infer<typeof CalcLikeConfigSchema>;

class FakeConfiguredApp implements App<CalcLikeConfig> {
  public readonly id: string;
  public readonly displayName: string;
  public readonly description = "测试用途";
  public readonly tools = [] as const;
  public readonly configSchema = CalcLikeConfigSchema;

  public received: CalcLikeConfig | "not-called" = "not-called";

  public constructor(id: string) {
    this.id = id;
    this.displayName = id;
  }

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    return "";
  }

  public async onStartup(ctx: AppStartupContext<CalcLikeConfig>): Promise<void> {
    this.received = ctx.config;
  }
}

class FakeUnconfiguredApp implements App {
  public readonly id: string;
  public readonly displayName: string;
  public readonly description = "测试用途";
  public readonly tools = [] as const;

  public received: unknown = "not-called";

  public constructor(id: string) {
    this.id = id;
    this.displayName = id;
  }

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    return "";
  }

  public async onStartup(ctx: AppStartupContext): Promise<void> {
    this.received = ctx.config;
  }
}

describe("AppManager.startupAll", () => {
  it("passes parsed config slice to onStartup when schema present", async () => {
    const manager = new AppManager();
    const app = new FakeConfiguredApp("calc-like");
    manager.register(app);

    await manager.startupAll({ "calc-like": { precision: 4 } });

    expect(app.received).toEqual({ precision: 4 });
  });

  it("falls back to schema defaults when raw slice is missing", async () => {
    const manager = new AppManager();
    const app = new FakeConfiguredApp("calc-like");
    manager.register(app);

    await manager.startupAll({});

    expect(app.received).toEqual({});
  });

  it("passes undefined config when App has no schema", async () => {
    const manager = new AppManager();
    const app = new FakeUnconfiguredApp("no-config");
    manager.register(app);

    await manager.startupAll({ "no-config": { ignored: true } });

    expect(app.received).toBeUndefined();
  });

  it("throws with App id when raw slice violates schema", async () => {
    const manager = new AppManager();
    manager.register(new FakeConfiguredApp("calc-like"));

    await expect(manager.startupAll({ "calc-like": { precision: -1 } })).rejects.toThrow(
      /calc-like/,
    );
  });

  it("works with default empty rawAppsConfig", async () => {
    const manager = new AppManager();
    const app = new FakeConfiguredApp("calc-like");
    manager.register(app);

    await manager.startupAll();

    expect(app.received).toEqual({});
  });

  it("rolls back already-started apps (reverse onShutdown) when a later app fails to start", async () => {
    const shutdownOrder: string[] = [];

    class LifecycleApp implements App {
      public readonly id: string;
      public readonly displayName: string;
      public readonly description = "测试用途";
      public readonly tools = [] as const;
      public startupCalled = false;
      public constructor(
        id: string,
        private readonly failOnStartup = false,
      ) {
        this.id = id;
        this.displayName = id;
      }
      public canInvoke(): boolean {
        return true;
      }
      public async help(): Promise<string> {
        return "";
      }
      public async onStartup(): Promise<void> {
        if (this.failOnStartup) {
          throw new Error(`${this.id} boom`);
        }
        this.startupCalled = true;
      }
      public async onShutdown(): Promise<void> {
        shutdownOrder.push(this.id);
      }
    }

    const manager = new AppManager();
    const first = new LifecycleApp("first");
    const second = new LifecycleApp("second");
    const failing = new LifecycleApp("failing", true);
    manager.register(first);
    manager.register(second);
    manager.register(failing);

    await expect(manager.startupAll()).rejects.toThrow(/failing boom/);

    expect(first.startupCalled).toBe(true);
    expect(second.startupCalled).toBe(true);
    // 反序回滚：已起的 second、first 被 onShutdown；失败的 failing 从未成功 onStartup，不回滚。
    expect(shutdownOrder).toEqual(["second", "first"]);
  });
});
