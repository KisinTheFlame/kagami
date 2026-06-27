import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AppLogger } from "@kagami/server-core/logger/logger";
import { TERMINAL_ERROR, type TerminalErrorCode } from "../domain/errors.js";
import type { TerminalStateDao } from "./terminal-state.dao.js";
import type { TerminalOutputDao } from "./terminal-output.dao.js";

const logger = new AppLogger({ source: "agent.terminal" });

export type TerminalServiceConfig = {
  /** 解析后的初始 cwd 绝对路径（例如 /Users/kisin/kagami） */
  initialCwd: string;
  commandTimeoutMs: number;
  previewBytes: number;
  maxOutputBytes: number;
  maxCommandLength: number;
  readOutputMaxSize: number;
  shell: string;
};

export type TerminalServiceDeps = {
  config: TerminalServiceConfig;
  terminalStateDao: TerminalStateDao;
  terminalOutputDao: TerminalOutputDao;
};

export type RunBashSuccess = {
  ok: true;
  exitCode: number;
  outputId: string | null;
  stdoutPreview: string;
  stdoutTruncated: boolean;
  stdoutTotalBytes: number;
  stderrPreview: string;
  stderrTruncated: boolean;
  stderrTotalBytes: number;
  cwd: string;
  durationMs: number;
};

export type RunBashFailure = {
  ok: false;
  error: TerminalErrorCode;
  message: string;
  /** 超时场景下保留已收到的部分输出 */
  outputId?: string | null;
  stdoutPreview?: string;
  stderrPreview?: string;
  exitCode?: number | null;
  signal?: string | null;
  cwd?: string;
  durationMs?: number;
};

export type RunBashResult = RunBashSuccess | RunBashFailure;

export type ReadOutputSuccess = {
  ok: true;
  outputId: string;
  stream: "stdout" | "stderr";
  offset: number;
  size: number;
  totalBytes: number;
  content: string;
  nextOffset: number;
  eof: boolean;
};

export type ReadOutputFailure = {
  ok: false;
  error: TerminalErrorCode;
  message: string;
};

export type ReadOutputResult = ReadOutputSuccess | ReadOutputFailure;

const CD_PREFIX_PATTERN = /^\s*cd(\s+(?<target>[^\s&|;<>`$]+))?\s*$/;

export class TerminalService {
  private readonly config: TerminalServiceConfig;
  private readonly terminalStateDao: TerminalStateDao;
  private readonly terminalOutputDao: TerminalOutputDao;
  private cwd: string;
  private initialized = false;
  private busy = false;

  public constructor({ config, terminalStateDao, terminalOutputDao }: TerminalServiceDeps) {
    this.config = config;
    this.terminalStateDao = terminalStateDao;
    this.terminalOutputDao = terminalOutputDao;
    this.cwd = config.initialCwd;
  }

  /**
   * Eager 启动初始化：
   * 1. 确保 initialCwd 目录存在（mkdir -p）
   * 2. 从 DAO 读取已持久化的 cwd；若不存在或目录已丢失，回退到 initialCwd
   * 3. 标记 initialized
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await mkdir(this.config.initialCwd, { recursive: true });
    } catch (error) {
      logger.errorWithCause("Failed to mkdir terminal initial cwd", error, {
        event: "agent.terminal.initialize.mkdir_failed",
        initialCwd: this.config.initialCwd,
      });
      throw error;
    }

    const persistedCwd = await this.terminalStateDao.loadCwd();
    if (persistedCwd !== null && (await isExistingDirectory(persistedCwd))) {
      this.cwd = persistedCwd;
    } else {
      if (persistedCwd !== null) {
        logger.warn("Persisted terminal cwd no longer exists, falling back to initialCwd", {
          event: "agent.terminal.initialize.persisted_cwd_missing",
          persistedCwd,
          initialCwd: this.config.initialCwd,
        });
      }
      this.cwd = this.config.initialCwd;
      // 写一次初始值进 DB，便于后续路径一致
      await this.terminalStateDao.saveCwd({ cwd: this.cwd });
    }

    this.initialized = true;
    logger.info("Terminal service initialized", {
      event: "agent.terminal.initialize.ok",
      cwd: this.cwd,
    });
  }

  public getCwd(): string {
    return this.cwd;
  }

  public getConfig(): TerminalServiceConfig {
    return this.config;
  }

  /**
   * 执行一条 bash 命令。
   * - `cd <dir>` 单条命令被拦截，直接更新 cwd 并返回空输出
   * - 其他命令 spawn 到配置的 shell，捕获 stdout/stderr 直到 maxOutputBytes 或 timeout
   * - timeout 会终止本次 shell 所在进程组，避免后台子进程残留
   * - 完整输出写入 DB（若任一 stream 非空），返回 output_id 供小镜分页读取
   */
  public async runBash(input: { command: string }): Promise<RunBashResult> {
    if (!this.initialized) {
      return {
        ok: false,
        error: TERMINAL_ERROR.INITIALIZATION_FAILED,
        message: "终端服务尚未初始化。",
      };
    }

    const rawCommand = input.command ?? "";
    const trimmed = rawCommand.trim();
    if (trimmed.length === 0) {
      return {
        ok: false,
        error: TERMINAL_ERROR.INVALID_COMMAND,
        message: "command 不能为空。",
      };
    }
    if (rawCommand.length > this.config.maxCommandLength) {
      return {
        ok: false,
        error: TERMINAL_ERROR.INVALID_COMMAND,
        message: `command 长度超过上限 ${this.config.maxCommandLength} 字符。`,
      };
    }

    if (this.busy) {
      return {
        ok: false,
        error: TERMINAL_ERROR.BUSY,
        message: "上一条 bash 命令尚未结束，拒绝并发调用。",
      };
    }

    // 立即占用 busy 标志，防止并发调用在后续 await 之间穿透
    this.busy = true;
    try {
      // 拦截单条 cd：直接改 state.cwd，不 spawn
      const cdMatch = CD_PREFIX_PATTERN.exec(rawCommand);
      if (cdMatch) {
        return await this.handleCdCommand({
          rawCommand,
          target: cdMatch.groups?.target ?? null,
        });
      }

      // 验证 cwd 仍然存在
      if (!(await isExistingDirectory(this.cwd))) {
        logger.warn("Current cwd disappeared, falling back to initialCwd", {
          event: "agent.terminal.runBash.cwd_missing",
          previousCwd: this.cwd,
          initialCwd: this.config.initialCwd,
        });
        this.cwd = this.config.initialCwd;
        await this.terminalStateDao.saveCwd({ cwd: this.cwd });
        return {
          ok: false,
          error: TERMINAL_ERROR.CWD_MISSING,
          message: `之前所在的目录已经不存在，已回退到 ${this.cwd}。请重新执行命令。`,
          cwd: this.cwd,
        };
      }

      const start = Date.now();
      return await this.executeSpawn({ rawCommand, start });
    } finally {
      this.busy = false;
    }
  }

  public async readOutput(input: {
    outputId: string;
    stream: "stdout" | "stderr";
    offset?: number;
    size?: number;
  }): Promise<ReadOutputResult> {
    if (input.stream !== "stdout" && input.stream !== "stderr") {
      return {
        ok: false,
        error: TERMINAL_ERROR.INVALID_STREAM,
        message: "stream 必须是 stdout 或 stderr。",
      };
    }

    const record = await this.terminalOutputDao.findByOutputId({
      outputId: input.outputId,
    });
    if (!record) {
      return {
        ok: false,
        error: TERMINAL_ERROR.OUTPUT_NOT_FOUND,
        message: `找不到 output_id=${input.outputId} 对应的输出。`,
      };
    }

    const full = input.stream === "stdout" ? record.stdout : record.stderr;
    const totalBytes = Buffer.byteLength(full, "utf8");
    const rawOffset = typeof input.offset === "number" ? input.offset : 0;
    const clampedOffset = Math.max(0, Math.min(rawOffset, totalBytes));
    const rawSize = typeof input.size === "number" ? input.size : this.config.readOutputMaxSize;
    const clampedSize = Math.max(
      0,
      Math.min(rawSize, this.config.readOutputMaxSize, totalBytes - clampedOffset),
    );

    const buffer = Buffer.from(full, "utf8");
    const slice = buffer.slice(clampedOffset, clampedOffset + clampedSize);
    const content = sanitizeUtf8Buffer(slice);
    const nextOffset = clampedOffset + clampedSize;

    return {
      ok: true,
      outputId: record.outputId,
      stream: input.stream,
      offset: clampedOffset,
      size: clampedSize,
      totalBytes,
      content,
      nextOffset,
      eof: nextOffset >= totalBytes,
    };
  }

  private async handleCdCommand(input: {
    rawCommand: string;
    target: string | null;
  }): Promise<RunBashResult> {
    const start = Date.now();
    const rawTarget = input.target ?? os.homedir();
    // 先展开 ~ 再 resolve，否则 path.resolve(cwd, "~/foo") 会产生 "{cwd}/~/foo"
    const expanded = expandHome(rawTarget);
    const resolved = path.isAbsolute(expanded)
      ? path.normalize(expanded)
      : path.resolve(this.cwd, expanded);

    if (!(await isExistingDirectory(resolved))) {
      return {
        ok: false,
        error: TERMINAL_ERROR.CWD_MISSING,
        message: `目录不存在：${resolved}`,
        cwd: this.cwd,
        durationMs: Date.now() - start,
      };
    }

    this.cwd = resolved;
    await this.terminalStateDao.saveCwd({ cwd: this.cwd });
    logger.debug("Terminal cwd updated via cd", {
      event: "agent.terminal.cd.ok",
      cwd: this.cwd,
      command: truncateForLog(input.rawCommand),
    });
    return {
      ok: true,
      exitCode: 0,
      outputId: null,
      stdoutPreview: "",
      stdoutTruncated: false,
      stdoutTotalBytes: 0,
      stderrPreview: "",
      stderrTruncated: false,
      stderrTotalBytes: 0,
      cwd: this.cwd,
      durationMs: Date.now() - start,
    };
  }

  private async executeSpawn(input: { rawCommand: string; start: number }): Promise<RunBashResult> {
    const cwdAtStart = this.cwd;
    const { rawCommand, start } = input;

    return await new Promise<RunBashResult>(resolve => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutTotalBytes = 0;
      let stderrTotalBytes = 0;
      let stdoutCapReached = false;
      let stderrCapReached = false;
      let timedOut = false;
      let settling = false;
      let settled = false;

      const child = spawn(this.config.shell, ["-c", rawCommand], {
        cwd: cwdAtStart,
        detached: true,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const startSettling = (): boolean => {
        if (settled || settling) {
          return false;
        }
        settling = true;
        clearTimeout(timer);
        return true;
      };

      const settle = (result: RunBashResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        settling = false;
        clearTimeout(timer);
        resolve(result);
      };

      const buildCapturedOutput = (durationMs: number) => {
        const stdoutFull = Buffer.concat(stdoutChunks).toString("utf8");
        const stderrFull = Buffer.concat(stderrChunks).toString("utf8");
        const sanitizedStdout = sanitizeUtf8String(stdoutFull);
        const sanitizedStderr = sanitizeUtf8String(stderrFull);
        const stdoutPreview = sanitizeUtf8Buffer(
          Buffer.from(sanitizedStdout, "utf8").subarray(0, this.config.previewBytes),
        );
        const stderrPreview = sanitizeUtf8Buffer(
          Buffer.from(sanitizedStderr, "utf8").subarray(0, this.config.previewBytes),
        );
        const stdoutTruncated =
          stdoutCapReached || Buffer.byteLength(sanitizedStdout, "utf8") > this.config.previewBytes;
        const stderrTruncated =
          stderrCapReached || Buffer.byteLength(sanitizedStderr, "utf8") > this.config.previewBytes;

        return {
          sanitizedStdout,
          sanitizedStderr,
          stdoutPreview,
          stderrPreview,
          stdoutTruncated,
          stderrTruncated,
          durationMs,
        };
      };

      const timer = setTimeout(() => {
        if (!startSettling()) {
          return;
        }
        timedOut = true;
        killSpawnedProcessGroup(child, "SIGKILL");
        child.stdout?.destroy();
        child.stderr?.destroy();
        this.persistAndSettle({
          ...buildCapturedOutput(Date.now() - start),
          stdoutTotalBytes,
          stderrTotalBytes,
          code: null,
          signal: "SIGKILL",
          timedOut,
          cwdAtStart,
          rawCommand,
          settle,
        });
      }, this.config.commandTimeoutMs);

      child.on("error", err => {
        if (!startSettling()) {
          return;
        }
        logger.errorWithCause("Terminal bash spawn error", err, {
          event: "agent.terminal.runBash.spawn_error",
          cwd: cwdAtStart,
          command: truncateForLog(rawCommand),
        });
        settle({
          ok: false,
          error: TERMINAL_ERROR.SPAWN_FAILED,
          message: `无法启动 shell：${err.message}`,
          cwd: cwdAtStart,
          durationMs: Date.now() - start,
        });
      });

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutTotalBytes += chunk.length;
        if (!stdoutCapReached) {
          const remaining = this.config.maxOutputBytes - totalSize(stdoutChunks);
          if (remaining <= 0) {
            stdoutCapReached = true;
            return;
          }
          if (chunk.length <= remaining) {
            stdoutChunks.push(chunk);
          } else {
            stdoutChunks.push(chunk.subarray(0, remaining));
            stdoutCapReached = true;
          }
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderrTotalBytes += chunk.length;
        if (!stderrCapReached) {
          const remaining = this.config.maxOutputBytes - totalSize(stderrChunks);
          if (remaining <= 0) {
            stderrCapReached = true;
            return;
          }
          if (chunk.length <= remaining) {
            stderrChunks.push(chunk);
          } else {
            stderrChunks.push(chunk.subarray(0, remaining));
            stderrCapReached = true;
          }
        }
      });

      child.on("close", (code, signal) => {
        if (!startSettling()) {
          return;
        }
        const durationMs = Date.now() - start;

        if (code === null && signal !== null && !timedOut) {
          logger.warn("Terminal bash killed by signal", {
            event: "agent.terminal.runBash.killed",
            cwd: cwdAtStart,
            command: truncateForLog(rawCommand),
            signal,
            durationMs,
          });
          settle({
            ok: false,
            error: TERMINAL_ERROR.KILLED,
            message: `命令被信号终止：${signal}`,
            signal,
            exitCode: null,
            cwd: cwdAtStart,
            durationMs,
          });
          return;
        }

        // 正常结束：timeout 会在 timer 分支直接 settle，不再等待 close 事件。
        this.persistAndSettle({
          ...buildCapturedOutput(durationMs),
          stdoutTotalBytes,
          stderrTotalBytes,
          code,
          signal,
          timedOut,
          cwdAtStart,
          rawCommand,
          durationMs,
          settle,
        });
      });
    });
  }

  private persistAndSettle(input: {
    sanitizedStdout: string;
    sanitizedStderr: string;
    stdoutPreview: string;
    stderrPreview: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    stdoutTotalBytes: number;
    stderrTotalBytes: number;
    code: number | null;
    signal: string | null;
    timedOut: boolean;
    cwdAtStart: string;
    rawCommand: string;
    durationMs: number;
    settle: (result: RunBashResult) => void;
  }): void {
    const {
      sanitizedStdout,
      sanitizedStderr,
      stdoutPreview,
      stderrPreview,
      stdoutTruncated,
      stderrTruncated,
      stdoutTotalBytes,
      stderrTotalBytes,
      code,
      signal,
      timedOut,
      cwdAtStart,
      rawCommand,
      durationMs,
      settle,
    } = input;

    (async () => {
      let outputId: string | null = null;
      if (sanitizedStdout.length > 0 || sanitizedStderr.length > 0) {
        outputId = generateOutputId();
        try {
          await this.terminalOutputDao.save({
            outputId,
            stdout: sanitizedStdout,
            stderr: sanitizedStderr,
          });
        } catch (error) {
          logger.errorWithCause("Failed to persist terminal output", error, {
            event: timedOut
              ? "agent.terminal.runBash.save_partial_failed"
              : "agent.terminal.runBash.save_failed",
            outputId,
          });
          outputId = null;
        }
      }

      if (timedOut) {
        logger.warn("Terminal bash timed out", {
          event: "agent.terminal.runBash.timeout",
          cwd: cwdAtStart,
          command: truncateForLog(rawCommand),
          durationMs,
          outputId,
        });
        settle({
          ok: false,
          error: TERMINAL_ERROR.TIMEOUT,
          message: `命令执行超过 ${this.config.commandTimeoutMs} ms，已被强制终止。`,
          outputId,
          stdoutPreview,
          stderrPreview,
          signal: signal ?? null,
          exitCode: code,
          cwd: cwdAtStart,
          durationMs,
        });
      } else {
        logger.debug("Terminal bash ok", {
          event: "agent.terminal.runBash.ok",
          cwd: cwdAtStart,
          command: truncateForLog(rawCommand),
          exitCode: code ?? -1,
          stdoutBytes: stdoutTotalBytes,
          stderrBytes: stderrTotalBytes,
          durationMs,
          outputId,
        });
        settle({
          ok: true,
          exitCode: code ?? 0,
          outputId,
          stdoutPreview,
          stdoutTruncated,
          stdoutTotalBytes,
          stderrPreview,
          stderrTruncated,
          stderrTotalBytes,
          cwd: cwdAtStart,
          durationMs,
        });
      }
    })().catch(err => {
      logger.errorWithCause("Unexpected error settling terminal bash result", err, {
        event: "agent.terminal.runBash.settle_error",
      });
      settle({
        ok: false,
        error: TERMINAL_ERROR.SPAWN_FAILED,
        message: "命令结果处理失败。",
        cwd: cwdAtStart,
        durationMs,
      });
    });
  }
}

export function resolveTerminalInitialCwd(input: { initialCwd?: string }): string {
  if (input.initialCwd && input.initialCwd.trim().length > 0) {
    return expandHome(input.initialCwd.trim());
  }
  return path.join(os.homedir(), "kagami");
}

function expandHome(p: string): string {
  if (p === "~") {
    return os.homedir();
  }
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  // 非 tilde 路径原样返回，由调用方决定如何 resolve
  return p;
}

async function isExistingDirectory(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

function totalSize(chunks: Buffer[]): number {
  let t = 0;
  for (const c of chunks) {
    t += c.length;
  }
  return t;
}

function killSpawnedProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (typeof child.pid !== "number") {
    child.kill(signal);
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function sanitizeUtf8String(s: string): string {
  // Buffer.from("...", "utf8") 本身就会对非法字节做 replacement，但为了
  // 显式保证 JSON 可序列化，再把 lone surrogate 也替换掉
  return s.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "\uFFFD",
  );
}

function sanitizeUtf8Buffer(buf: Buffer): string {
  return sanitizeUtf8String(buf.toString("utf8"));
}

function generateOutputId(): string {
  return `out_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function truncateForLog(s: string): string {
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}
