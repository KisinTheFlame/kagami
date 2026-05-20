import { describe, expect, it } from "vitest";
import { TerminalApp, TERMINAL_APP_ID } from "../../../../src/agent/apps/terminal/terminal.app.js";
import type { TerminalStateDao } from "../../../../src/agent/capabilities/terminal/application/terminal-state.dao.js";
import type { TerminalOutputDao } from "../../../../src/agent/capabilities/terminal/application/terminal-output.dao.js";

function makeFakeStateDao(): TerminalStateDao {
  let cwd: string | null = null;
  return {
    async loadCwd(): Promise<string | null> {
      return cwd;
    },
    async saveCwd({ cwd: newCwd }: { cwd: string }): Promise<void> {
      cwd = newCwd;
    },
  };
}

function makeFakeOutputDao(): TerminalOutputDao {
  return {
    async save(): Promise<void> {},
    async findByOutputId(): Promise<null> {
      return null;
    },
  };
}

describe("TerminalApp", () => {
  it("registers id, displayName, configSchema, and tools", () => {
    const app = new TerminalApp({
      terminalStateDao: makeFakeStateDao(),
      terminalOutputDao: makeFakeOutputDao(),
    });
    expect(app.id).toBe(TERMINAL_APP_ID);
    expect(app.displayName).toBe("终端");
    expect(app.configSchema).toBeDefined();
    expect(app.tools.map(t => t.name)).toEqual(["bash", "read_bash_output"]);
  });

  it("canInvoke always returns true", () => {
    const app = new TerminalApp({
      terminalStateDao: makeFakeStateDao(),
      terminalOutputDao: makeFakeOutputDao(),
    });
    expect(app.canInvoke()).toBe(true);
  });

  it("help reports cwd 未初始化 before onStartup", async () => {
    const app = new TerminalApp({
      terminalStateDao: makeFakeStateDao(),
      terminalOutputDao: makeFakeOutputDao(),
    });
    const help = await app.help();
    expect(help).toContain("(未初始化)");
    expect(help).toContain("bash(command)");
    expect(help).toContain("read_bash_output");
  });

  it("configSchema accepts empty object and applies defaults", () => {
    const app = new TerminalApp({
      terminalStateDao: makeFakeStateDao(),
      terminalOutputDao: makeFakeOutputDao(),
    });
    const parsed = app.configSchema.parse({});
    expect(parsed.commandTimeoutMs).toBe(30_000);
    expect(parsed.previewBytes).toBe(2048);
    expect(parsed.maxOutputBytes).toBe(1_048_576);
    expect(parsed.maxCommandLength).toBe(4096);
    expect(parsed.readOutputMaxSize).toBe(4096);
    expect(parsed.shell).toBe("/bin/sh");
    expect(parsed.initialCwd).toBeUndefined();
  });

  it("configSchema rejects non-positive integers", () => {
    const app = new TerminalApp({
      terminalStateDao: makeFakeStateDao(),
      terminalOutputDao: makeFakeOutputDao(),
    });
    expect(() => app.configSchema.parse({ commandTimeoutMs: 0 })).toThrow();
    expect(() => app.configSchema.parse({ previewBytes: -1 })).toThrow();
  });

  it("configSchema rejects empty shell string", () => {
    const app = new TerminalApp({
      terminalStateDao: makeFakeStateDao(),
      terminalOutputDao: makeFakeOutputDao(),
    });
    expect(() => app.configSchema.parse({ shell: "" })).toThrow();
  });

  it("tools surface error result before onStartup runs", async () => {
    const app = new TerminalApp({
      terminalStateDao: makeFakeStateDao(),
      terminalOutputDao: makeFakeOutputDao(),
    });
    const bash = app.tools.find(t => t.name === "bash");
    if (!bash) {
      throw new Error("bash tool 未找到");
    }
    const result = await bash.execute({ command: "ls" }, {} as Parameters<typeof bash.execute>[1]);
    const parsed = JSON.parse(result.content) as Record<string, unknown>;
    expect(parsed.ok).toBe(false);
    expect(typeof parsed.error === "string" && parsed.error.includes("未完成 onStartup")).toBe(
      true,
    );
  });
});
