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
});
