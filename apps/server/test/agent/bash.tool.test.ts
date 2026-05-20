import { describe, expect, it } from "vitest";
import { BashTool, BASH_TOOL_NAME } from "../../src/agent/capabilities/terminal/tools/bash.tool.js";
import {
  ReadBashOutputTool,
  READ_BASH_OUTPUT_TOOL_NAME,
} from "../../src/agent/capabilities/terminal/tools/read-bash-output.tool.js";
import { TERMINAL_ERROR } from "../../src/agent/capabilities/terminal/domain/errors.js";
import type { TerminalService } from "../../src/agent/capabilities/terminal/application/terminal.service.js";

function createStubService(
  runResult: Awaited<ReturnType<TerminalService["runBash"]>>,
  readResult: Awaited<ReturnType<TerminalService["readOutput"]>>,
): TerminalService {
  return {
    runBash: async () => runResult,
    readOutput: async () => readResult,
    initialize: async () => {},
    getCwd: () => "/tmp/fake",
    getConfig: () => ({
      initialCwd: "/tmp/fake",
      commandTimeoutMs: 1,
      previewBytes: 1,
      maxOutputBytes: 1,
      maxCommandLength: 1,
      readOutputMaxSize: 1,
      shell: "/bin/sh",
    }),
  } as unknown as TerminalService;
}

describe("bash tool", () => {
  it("serializes success result with snake_case fields", async () => {
    const tool = new BashTool({
      getTerminalService: () =>
        createStubService(
          {
            ok: true,
            exitCode: 0,
            outputId: "out_abc",
            stdoutPreview: "hi",
            stdoutTruncated: false,
            stdoutTotalBytes: 2,
            stderrPreview: "",
            stderrTruncated: false,
            stderrTotalBytes: 0,
            cwd: "/tmp",
            durationMs: 3,
          },
          { ok: false, error: TERMINAL_ERROR.OUTPUT_NOT_FOUND, message: "n/a" },
        ),
    });
    expect(tool.name).toBe(BASH_TOOL_NAME);
    const result = await tool.execute(
      { command: "echo hi" },
      {} as Parameters<typeof tool.execute>[1],
    );
    const parsed = JSON.parse(result.content) as Record<string, unknown>;
    expect(parsed.ok).toBe(true);
    expect(parsed.exit_code).toBe(0);
    expect(parsed.output_id).toBe("out_abc");
    expect(parsed.stdout_preview).toBe("hi");
    expect(parsed.cwd).toBe("/tmp");
  });

  it("serializes failure result with snake_case fields", async () => {
    const tool = new BashTool({
      getTerminalService: () =>
        createStubService(
          {
            ok: false,
            error: TERMINAL_ERROR.TIMEOUT,
            message: "timed out",
            outputId: "out_partial",
            stdoutPreview: "part",
            stderrPreview: "",
            exitCode: null,
            signal: "SIGKILL",
            cwd: "/tmp",
            durationMs: 100,
          },
          { ok: false, error: TERMINAL_ERROR.OUTPUT_NOT_FOUND, message: "n/a" },
        ),
    });
    const result = await tool.execute(
      { command: "sleep 100" },
      {} as Parameters<typeof tool.execute>[1],
    );
    const parsed = JSON.parse(result.content) as Record<string, unknown>;
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe(TERMINAL_ERROR.TIMEOUT);
    expect(parsed.output_id).toBe("out_partial");
    expect(parsed.signal).toBe("SIGKILL");
  });

  it("rejects empty command via zod schema", async () => {
    const tool = new BashTool({
      getTerminalService: () =>
        createStubService(
          {
            ok: true,
            exitCode: 0,
            outputId: null,
            stdoutPreview: "",
            stdoutTruncated: false,
            stdoutTotalBytes: 0,
            stderrPreview: "",
            stderrTruncated: false,
            stderrTotalBytes: 0,
            cwd: "/tmp",
            durationMs: 0,
          },
          { ok: false, error: TERMINAL_ERROR.OUTPUT_NOT_FOUND, message: "n/a" },
        ),
    });
    const result = await tool.execute({ command: "" }, {} as Parameters<typeof tool.execute>[1]);
    const parsed = JSON.parse(result.content) as Record<string, unknown>;
    expect(parsed.ok).toBe(false);
  });
});

describe("read_bash_output tool", () => {
  it("serializes a paginated read", async () => {
    const tool = new ReadBashOutputTool({
      getTerminalService: () =>
        createStubService(
          {
            ok: true,
            exitCode: 0,
            outputId: "x",
            stdoutPreview: "",
            stdoutTruncated: false,
            stdoutTotalBytes: 0,
            stderrPreview: "",
            stderrTruncated: false,
            stderrTotalBytes: 0,
            cwd: "/",
            durationMs: 0,
          },
          {
            ok: true,
            outputId: "out_abc",
            stream: "stdout",
            offset: 0,
            size: 4,
            totalBytes: 10,
            content: "abcd",
            nextOffset: 4,
            eof: false,
          },
        ),
    });
    expect(tool.name).toBe(READ_BASH_OUTPUT_TOOL_NAME);
    const result = await tool.execute(
      { output_id: "out_abc", stream: "stdout", offset: 0, size: 4 },
      {} as Parameters<typeof tool.execute>[1],
    );
    const parsed = JSON.parse(result.content) as Record<string, unknown>;
    expect(parsed.ok).toBe(true);
    expect(parsed.content).toBe("abcd");
    expect(parsed.next_offset).toBe(4);
    expect(parsed.eof).toBe(false);
  });

  it("serializes a not-found failure", async () => {
    const tool = new ReadBashOutputTool({
      getTerminalService: () =>
        createStubService(
          {
            ok: true,
            exitCode: 0,
            outputId: "x",
            stdoutPreview: "",
            stdoutTruncated: false,
            stdoutTotalBytes: 0,
            stderrPreview: "",
            stderrTruncated: false,
            stderrTotalBytes: 0,
            cwd: "/",
            durationMs: 0,
          },
          { ok: false, error: TERMINAL_ERROR.OUTPUT_NOT_FOUND, message: "missing" },
        ),
    });
    const result = await tool.execute(
      { output_id: "out_missing" },
      {} as Parameters<typeof tool.execute>[1],
    );
    const parsed = JSON.parse(result.content) as Record<string, unknown>;
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe(TERMINAL_ERROR.OUTPUT_NOT_FOUND);
  });
});
