import { z } from "zod";
import type { App, AppStartupContext } from "@kagami/agent-runtime";
import {
  resolveTerminalInitialCwd,
  TerminalService,
} from "../../capabilities/terminal/application/terminal.service.js";
import type { TerminalOutputDao } from "../../capabilities/terminal/application/terminal-output.dao.js";
import type { TerminalStateDao } from "../../capabilities/terminal/application/terminal-state.dao.js";
import { BashTool } from "../../capabilities/terminal/tools/bash.tool.js";
import { ReadBashOutputTool } from "../../capabilities/terminal/tools/read-bash-output.tool.js";

export const TERMINAL_APP_ID = "terminal";

const DEFAULT_TERMINAL_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_TERMINAL_PREVIEW_BYTES = 2048;
const DEFAULT_TERMINAL_MAX_OUTPUT_BYTES = 1_048_576;
const DEFAULT_TERMINAL_MAX_COMMAND_LENGTH = 4096;
const DEFAULT_TERMINAL_READ_OUTPUT_MAX_SIZE = 4096;
const DEFAULT_TERMINAL_SHELL = "/bin/sh";

const PositiveInt = z.number().int().positive();
const NonEmptyString = z.string().min(1);

/**
 * TerminalApp 的配置 schema。原本散在 server.agent.terminal.* 下的字段全部
 * 搬到这里，由 AppManager.startupAll 时按 `server.apps.terminal` 切片解析。
 *
 * initialCwd 可选：未填则 onStartup 时回退到 ~/kagami（由 resolveTerminalInitialCwd 决定）。
 */
const TerminalConfigSchema = z
  .object({
    initialCwd: NonEmptyString.optional(),
    commandTimeoutMs: PositiveInt.default(DEFAULT_TERMINAL_COMMAND_TIMEOUT_MS),
    previewBytes: PositiveInt.default(DEFAULT_TERMINAL_PREVIEW_BYTES),
    maxOutputBytes: PositiveInt.default(DEFAULT_TERMINAL_MAX_OUTPUT_BYTES),
    maxCommandLength: PositiveInt.default(DEFAULT_TERMINAL_MAX_COMMAND_LENGTH),
    readOutputMaxSize: PositiveInt.default(DEFAULT_TERMINAL_READ_OUTPUT_MAX_SIZE),
    shell: NonEmptyString.default(DEFAULT_TERMINAL_SHELL),
  })
  .default({});

type TerminalConfig = z.infer<typeof TerminalConfigSchema>;

type TerminalAppDeps = {
  terminalStateDao: TerminalStateDao;
  terminalOutputDao: TerminalOutputDao;
};

/**
 * 终端 App。把 capabilities/terminal/ 里的 TerminalService + 两个工具包装成
 * Kagami 桌面上的一个能力单元。
 *
 * - 工具：bash(command)、read_bash_output(output_id, ...)
 * - 自管 TerminalService：onStartup 时按 configSchema 解析后的 config 实例化并
 *   await initialize()；工具通过闭包从 App 拿 service。
 * - canInvoke 一律 true，App 内目前没有 view 切换。
 *
 * 设计依据见仓库根 CLAUDE.md "工具组织：InvokeTool 是顶层工具集的稳定壳"。
 */
export class TerminalApp implements App<TerminalConfig> {
  public readonly id = TERMINAL_APP_ID;
  public readonly displayName = "终端";
  public readonly configSchema = TerminalConfigSchema;
  public readonly tools: readonly (BashTool | ReadBashOutputTool)[];

  private readonly terminalStateDao: TerminalStateDao;
  private readonly terminalOutputDao: TerminalOutputDao;
  private terminalService: TerminalService | null = null;

  public constructor({ terminalStateDao, terminalOutputDao }: TerminalAppDeps) {
    this.terminalStateDao = terminalStateDao;
    this.terminalOutputDao = terminalOutputDao;
    const getTerminalService = (): TerminalService => {
      if (!this.terminalService) {
        throw new Error("TerminalApp 尚未完成 onStartup，TerminalService 未就绪");
      }
      return this.terminalService;
    };
    this.tools = [
      new BashTool({ getTerminalService }),
      new ReadBashOutputTool({ getTerminalService }),
    ];
  }

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    const cwd = this.terminalService?.getCwd() ?? "(未初始化)";
    return [
      `你在终端 App 里。当前工作目录：${cwd}`,
      "",
      "可调用工具：",
      "  - bash(command): 执行一条完整 shell 命令。单条 `cd <dir>` 会被拦截并更新工作目录；不支持交互式命令。",
      "  - read_bash_output(output_id, stream?, offset?, size?): 分页读取上一条 bash 的完整 stdout/stderr。",
      "",
      "调 back_to_portal 退出本 App 回到桌面。",
    ].join("\n");
  }

  public async onStartup(ctx: AppStartupContext<TerminalConfig>): Promise<void> {
    const config = ctx.config;
    this.terminalService = new TerminalService({
      config: {
        initialCwd: resolveTerminalInitialCwd({ initialCwd: config.initialCwd }),
        commandTimeoutMs: config.commandTimeoutMs,
        previewBytes: config.previewBytes,
        maxOutputBytes: config.maxOutputBytes,
        maxCommandLength: config.maxCommandLength,
        readOutputMaxSize: config.readOutputMaxSize,
        shell: config.shell,
      },
      terminalStateDao: this.terminalStateDao,
      terminalOutputDao: this.terminalOutputDao,
    });
    await this.terminalService.initialize();
  }
}
