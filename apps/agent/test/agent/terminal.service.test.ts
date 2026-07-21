import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  TerminalOutputDao,
  TerminalOutputRecord,
} from "../../src/agent/capabilities/terminal/application/terminal-output.dao.js";
import type { TerminalStateDao } from "../../src/agent/capabilities/terminal/application/terminal-state.dao.js";
import {
  TerminalService,
  type TerminalServiceConfig,
} from "../../src/agent/capabilities/terminal/application/terminal.service.js";
import { TERMINAL_ERROR } from "../../src/agent/capabilities/terminal/domain/errors.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

initTestLoggerRuntime();

class InMemoryTerminalStateDao implements TerminalStateDao {
  private cwd: string | null = null;

  public async loadCwd(): Promise<string | null> {
    return this.cwd;
  }

  public async saveCwd(input: { cwd: string }): Promise<void> {
    this.cwd = input.cwd;
  }
}

class InMemoryTerminalOutputDao implements TerminalOutputDao {
  public readonly records = new Map<string, TerminalOutputRecord>();
  public saveFailsOnce = false;

  public async save(input: { outputId: string; stdout: string; stderr: string }): Promise<void> {
    if (this.saveFailsOnce) {
      this.saveFailsOnce = false;
      throw new Error("forced save failure");
    }
    this.records.set(input.outputId, {
      outputId: input.outputId,
      stdout: input.stdout,
      stderr: input.stderr,
      createdAt: new Date(),
    });
  }

  public async findByOutputId(input: { outputId: string }): Promise<TerminalOutputRecord | null> {
    return this.records.get(input.outputId) ?? null;
  }
}

async function makeTempDir(prefix: string): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), prefix));
}

async function makeService(options: {
  initialCwd: string;
  overrides?: Partial<TerminalServiceConfig>;
}): Promise<{
  service: TerminalService;
  stateDao: InMemoryTerminalStateDao;
  outputDao: InMemoryTerminalOutputDao;
}> {
  const stateDao = new InMemoryTerminalStateDao();
  const outputDao = new InMemoryTerminalOutputDao();
  const config: TerminalServiceConfig = {
    initialCwd: options.initialCwd,
    commandTimeoutMs: 5_000,
    previewBytes: 256,
    maxOutputBytes: 1_000_000,
    maxCommandLength: 1024,
    readOutputMaxSize: 512,
    shell: "/bin/sh",
    ...options.overrides,
  };
  const service = new TerminalService({
    config,
    terminalStateDao: stateDao,
    terminalOutputDao: outputDao,
  });
  await service.initialize();
  return { service, stateDao, outputDao };
}

describe("TerminalService", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await makeTempDir("kagami-terminal-test-");
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  describe("initialize", () => {
    it("creates initialCwd if missing and persists it", async () => {
      const target = path.join(tmpRoot, "home");
      const { service, stateDao } = await makeService({ initialCwd: target });
      expect(service.getCwd()).toBe(target);
      expect(await stateDao.loadCwd()).toBe(target);
    });

    it("restores persisted cwd when it still exists", async () => {
      const initial = path.join(tmpRoot, "home");
      const restored = path.join(tmpRoot, "persisted");
      await writeFile(path.join(tmpRoot, "placeholder.txt"), "x");
      const stateDao = new InMemoryTerminalStateDao();
      const outputDao = new InMemoryTerminalOutputDao();
      // Pre-create both directories
      await mkdtemp(restored.replace("persisted", "persisted-")); // dummy to ensure tmp area exists
      const { mkdir } = await import("node:fs/promises");
      await mkdir(restored, { recursive: true });
      await stateDao.saveCwd({ cwd: restored });

      const service = new TerminalService({
        config: {
          initialCwd: initial,
          commandTimeoutMs: 5_000,
          previewBytes: 256,
          maxOutputBytes: 1_000_000,
          maxCommandLength: 1024,
          readOutputMaxSize: 512,
          shell: "/bin/sh",
        },
        terminalStateDao: stateDao,
        terminalOutputDao: outputDao,
      });
      await service.initialize();
      expect(service.getCwd()).toBe(restored);
    });

    it("falls back to initialCwd when persisted cwd is gone", async () => {
      const initial = path.join(tmpRoot, "home");
      const stateDao = new InMemoryTerminalStateDao();
      const outputDao = new InMemoryTerminalOutputDao();
      await stateDao.saveCwd({ cwd: path.join(tmpRoot, "vanished") });

      const service = new TerminalService({
        config: {
          initialCwd: initial,
          commandTimeoutMs: 5_000,
          previewBytes: 256,
          maxOutputBytes: 1_000_000,
          maxCommandLength: 1024,
          readOutputMaxSize: 512,
          shell: "/bin/sh",
        },
        terminalStateDao: stateDao,
        terminalOutputDao: outputDao,
      });
      await service.initialize();
      expect(service.getCwd()).toBe(initial);
      expect(await stateDao.loadCwd()).toBe(initial);
    });

    it("is idempotent", async () => {
      const target = path.join(tmpRoot, "home");
      const { service } = await makeService({ initialCwd: target });
      await service.initialize();
      await service.initialize();
      expect(service.getCwd()).toBe(target);
    });
  });

  describe("runBash: happy path", () => {
    it("runs a simple command and persists output under an output_id", async () => {
      const { service, outputDao } = await makeService({
        initialCwd: tmpRoot,
      });
      const result = await service.runBash({ command: "printf 'hello world'" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.exitCode).toBe(0);
      expect(result.stdoutPreview).toBe("hello world");
      expect(result.stdoutTruncated).toBe(false);
      expect(result.outputId).not.toBeNull();
      expect(outputDao.records.get(result.outputId!)?.stdout).toBe("hello world");
    });

    it("returns non-zero exit code as ok=true (not an error)", async () => {
      const { service } = await makeService({ initialCwd: tmpRoot });
      const result = await service.runBash({ command: "false" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.exitCode).not.toBe(0);
    });

    it("assigns no output_id when stdout and stderr are both empty", async () => {
      const { service, outputDao } = await makeService({ initialCwd: tmpRoot });
      const result = await service.runBash({ command: "true" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.outputId).toBeNull();
      expect(outputDao.records.size).toBe(0);
    });

    it("captures stderr independently", async () => {
      const { service, outputDao } = await makeService({ initialCwd: tmpRoot });
      const result = await service.runBash({
        command: "printf 'oops' >&2",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.stderrPreview).toBe("oops");
      expect(result.stdoutPreview).toBe("");
      expect(outputDao.records.get(result.outputId!)?.stderr).toBe("oops");
    });

    it("truncates preview when stdout exceeds previewBytes", async () => {
      const { service, outputDao } = await makeService({
        initialCwd: tmpRoot,
        overrides: { previewBytes: 10 },
      });
      const result = await service.runBash({
        command: "printf '%s' '01234567890123456789'",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.stdoutPreview).toHaveLength(10);
      expect(result.stdoutTruncated).toBe(true);
      expect(outputDao.records.get(result.outputId!)?.stdout).toBe("01234567890123456789");
    });
  });

  describe("runBash: cd interception", () => {
    it("cd <abs-dir> updates cwd without spawn and persists it", async () => {
      const sub = path.join(tmpRoot, "sub");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(sub, { recursive: true });
      const { service, stateDao } = await makeService({ initialCwd: tmpRoot });
      const result = await service.runBash({ command: `cd ${sub}` });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.cwd).toBe(sub);
      expect(service.getCwd()).toBe(sub);
      expect(await stateDao.loadCwd()).toBe(sub);
      expect(result.outputId).toBeNull();
    });

    it("cd <relative> resolves against current cwd", async () => {
      const sub = path.join(tmpRoot, "sub2");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(sub, { recursive: true });
      const { service } = await makeService({ initialCwd: tmpRoot });
      const result = await service.runBash({ command: "cd sub2" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(service.getCwd()).toBe(sub);
    });

    it("cd to non-existing dir returns CWD_MISSING and does not change cwd", async () => {
      const { service } = await makeService({ initialCwd: tmpRoot });
      const result = await service.runBash({ command: "cd nope-does-not-exist" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe(TERMINAL_ERROR.CWD_MISSING);
      expect(service.getCwd()).toBe(tmpRoot);
    });

    it("cd ~ resolves to home directory", async () => {
      const { service } = await makeService({ initialCwd: tmpRoot });
      const homedir = (await import("node:os")).default.homedir();
      const result = await service.runBash({ command: "cd ~" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(service.getCwd()).toBe(homedir);
    });

    it("cd ~/subdir resolves tilde BEFORE path.resolve (P1 fix)", async () => {
      const homedir = (await import("node:os")).default.homedir();
      // 自建 $HOME 下的唯一临时目录再 cd 进去，而不是假设预先存在的 ~/kagami——
      // 后者只在开发机上恰好存在，干净 CI runner 上没有会导致 cd 失败。
      const sub = await mkdtemp(path.join(homedir, "kagami-tilde-test-"));
      try {
        const { service } = await makeService({ initialCwd: tmpRoot });
        const result = await service.runBash({ command: `cd ~/${path.basename(sub)}` });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(service.getCwd()).toBe(sub);
      } finally {
        await rm(sub, { recursive: true, force: true });
      }
    });

    it("multi-command (cd a && ls) is NOT intercepted and does not update state.cwd", async () => {
      const sub = path.join(tmpRoot, "multicd");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(sub, { recursive: true });
      const { service } = await makeService({ initialCwd: tmpRoot });
      const result = await service.runBash({ command: "cd multicd && pwd" });
      expect(result.ok).toBe(true);
      // state.cwd stays at tmpRoot because the full command ran in a subshell
      expect(service.getCwd()).toBe(tmpRoot);
    });
  });

  describe("runBash: validation and errors", () => {
    it("empty command returns INVALID_COMMAND", async () => {
      const { service } = await makeService({ initialCwd: tmpRoot });
      const result = await service.runBash({ command: "   " });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe(TERMINAL_ERROR.INVALID_COMMAND);
    });

    it("over-long command returns INVALID_COMMAND", async () => {
      const { service } = await makeService({
        initialCwd: tmpRoot,
        overrides: { maxCommandLength: 16 },
      });
      const result = await service.runBash({
        command: "echo this command is definitely too long",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe(TERMINAL_ERROR.INVALID_COMMAND);
    });

    it("rejects concurrent bash with BUSY", async () => {
      const { service } = await makeService({ initialCwd: tmpRoot });
      // Launch a slow command, then try to invoke another before it resolves
      const slow = service.runBash({ command: "sleep 0.15" });
      const concurrent = service.runBash({ command: "echo second" });
      const [slowResult, concurrentResult] = await Promise.all([slow, concurrent]);
      expect(slowResult.ok).toBe(true);
      expect(concurrentResult.ok).toBe(false);
      if (concurrentResult.ok) return;
      expect(concurrentResult.error).toBe(TERMINAL_ERROR.BUSY);
    });

    it("timeout kills the process and returns TIMEOUT with partial output_id", async () => {
      const { service, outputDao } = await makeService({
        initialCwd: tmpRoot,
        overrides: { commandTimeoutMs: 120 },
      });
      const result = await service.runBash({
        command: "printf 'partial '; sleep 2; printf 'never'",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe(TERMINAL_ERROR.TIMEOUT);
      // partial stdout is captured
      if (result.outputId) {
        expect(outputDao.records.get(result.outputId)?.stdout).toContain("partial");
      }
    });

    it("timeout kills descendant processes in the spawned process group", async () => {
      const marker = path.join(tmpRoot, "timeout-grandchild-marker.txt");
      const childScript = [
        "setTimeout(() => {",
        `  require("node:fs").writeFileSync(${JSON.stringify(marker)}, "survived");`,
        "}, 250);",
      ].join("\n");
      const parentScript = [
        "require('node:child_process').spawn(",
        "  process.execPath,",
        `  ["-e", ${JSON.stringify(childScript)}],`,
        "  { stdio: 'ignore' },",
        ");",
        "setTimeout(() => {}, 5_000);",
      ].join("\n");
      const { service } = await makeService({
        initialCwd: tmpRoot,
        overrides: { commandTimeoutMs: 100 },
      });

      const result = await service.runBash({
        command: `${shellQuote(process.execPath)} -e ${shellQuote(parentScript)}`,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe(TERMINAL_ERROR.TIMEOUT);
      // 等到孙进程的 250ms marker 定时点之后再断言（kill 在 100ms 触发；若 kill 未覆盖进程组，
      // marker 会在 ~250ms 落盘，450ms 处检查仍留 200ms 裕量）。
      await new Promise(resolve => setTimeout(resolve, 450));
      await expect(access(marker)).rejects.toThrow();
    });

    it("timeout returns without waiting for an escaped child that keeps stdout open", async () => {
      const escapedChildScript = "setTimeout(() => {}, 1_500);";
      const parentScript = [
        "const child = require('node:child_process').spawn(",
        "  process.execPath,",
        `  ["-e", ${JSON.stringify(escapedChildScript)}],`,
        "  { detached: true, stdio: ['ignore', 'inherit', 'inherit'] },",
        ");",
        "child.unref();",
        "setTimeout(() => {}, 5_000);",
      ].join("\n");
      const { service } = await makeService({
        initialCwd: tmpRoot,
        overrides: { commandTimeoutMs: 100 },
      });

      const start = Date.now();
      const result = await service.runBash({
        command: `${shellQuote(process.execPath)} -e ${shellQuote(parentScript)}`,
      });
      const elapsedMs = Date.now() - start;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe(TERMINAL_ERROR.TIMEOUT);
      expect(elapsedMs).toBeLessThan(800);
    });

    it("cwd disappeared between commands returns CWD_MISSING and falls back", async () => {
      const sub = path.join(tmpRoot, "transient");
      const { mkdir, rm: rmDir } = await import("node:fs/promises");
      await mkdir(sub, { recursive: true });
      const { service } = await makeService({ initialCwd: tmpRoot });
      await service.runBash({ command: `cd ${sub}` });
      await rmDir(sub, { recursive: true, force: true });
      const result = await service.runBash({ command: "pwd" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe(TERMINAL_ERROR.CWD_MISSING);
      expect(service.getCwd()).toBe(tmpRoot);
    });
  });

  describe("readOutput", () => {
    it("returns paginated slice with next_offset and eof", async () => {
      const { service } = await makeService({
        initialCwd: tmpRoot,
        overrides: { previewBytes: 4, readOutputMaxSize: 4 },
      });
      const runResult = await service.runBash({
        command: "printf '%s' 'abcdefghij'",
      });
      expect(runResult.ok).toBe(true);
      if (!runResult.ok || !runResult.outputId) return;

      const page1 = await service.readOutput({
        outputId: runResult.outputId,
        stream: "stdout",
        offset: 0,
        size: 4,
      });
      expect(page1.ok).toBe(true);
      if (!page1.ok) return;
      expect(page1.content).toBe("abcd");
      expect(page1.nextOffset).toBe(4);
      expect(page1.eof).toBe(false);

      const page2 = await service.readOutput({
        outputId: runResult.outputId,
        stream: "stdout",
        offset: 4,
        size: 4,
      });
      expect(page2.ok).toBe(true);
      if (!page2.ok) return;
      expect(page2.content).toBe("efgh");

      const page3 = await service.readOutput({
        outputId: runResult.outputId,
        stream: "stdout",
        offset: 8,
        size: 4,
      });
      expect(page3.ok).toBe(true);
      if (!page3.ok) return;
      expect(page3.content).toBe("ij");
      expect(page3.eof).toBe(true);
    });

    it("clamps size to readOutputMaxSize", async () => {
      const { service } = await makeService({
        initialCwd: tmpRoot,
        overrides: { previewBytes: 8, readOutputMaxSize: 4 },
      });
      const runResult = await service.runBash({
        command: "printf '%s' 'abcdefghij'",
      });
      if (!runResult.ok || !runResult.outputId) return;
      const page = await service.readOutput({
        outputId: runResult.outputId,
        stream: "stdout",
        offset: 0,
        size: 100,
      });
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      expect(page.content.length).toBe(4);
    });

    it("returns OUTPUT_NOT_FOUND for unknown id", async () => {
      const { service } = await makeService({ initialCwd: tmpRoot });
      const result = await service.readOutput({
        outputId: "out_nonexistent",
        stream: "stdout",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe(TERMINAL_ERROR.OUTPUT_NOT_FOUND);
    });

    it("returns eof=true when offset is beyond total bytes", async () => {
      const { service } = await makeService({ initialCwd: tmpRoot });
      const runResult = await service.runBash({ command: "printf '%s' 'abc'" });
      if (!runResult.ok || !runResult.outputId) return;
      const result = await service.readOutput({
        outputId: runResult.outputId,
        stream: "stdout",
        offset: 100,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.content).toBe("");
      expect(result.eof).toBe(true);
    });
  });
});

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
