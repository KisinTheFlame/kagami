import { z } from "zod";
import { ZodToolComponent, type ToolKind } from "@kagami/agent-runtime";
import type { TerminalService } from "../application/terminal.service.js";

export const BASH_TOOL_NAME = "bash";

const BashArgumentsSchema = z.object({
  command: z.string().min(1),
});

export class BashTool extends ZodToolComponent<typeof BashArgumentsSchema> {
  public readonly name = BASH_TOOL_NAME;
  public readonly description =
    "在终端里执行一条完整的 shell 命令（例如 git log、cat 某个文件、ls 当前目录）。只能在 terminal 状态下通过 invoke 调用。返回结构化结果，stdout/stderr 会截断为 preview，完整内容通过 read_bash_output 分页读取。";
  public readonly parameters = {
    type: "object",
    properties: {
      command: {
        type: "string",
        description:
          "要执行的完整 shell 命令字符串。单条 cd 命令（例如 cd foo 或 cd /abs/path）会被拦截并更新工作目录。不支持交互式命令（vim/less/top 会在超时后被强杀）。",
      },
    },
    required: ["command"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = BashArgumentsSchema;
  // TerminalService 由所属 TerminalApp 在 onStartup 阶段实例化，所以这里用闭包延迟取，
  // 不在工具构造期就要求拿到实例。
  private readonly getTerminalService: () => TerminalService;

  public constructor({ getTerminalService }: { getTerminalService: () => TerminalService }) {
    super();
    this.getTerminalService = getTerminalService;
  }

  protected async executeTyped(input: z.infer<typeof BashArgumentsSchema>): Promise<string> {
    const result = await this.getTerminalService().runBash({ command: input.command });
    if (result.ok) {
      return JSON.stringify({
        ok: true,
        exit_code: result.exitCode,
        output_id: result.outputId,
        stdout_preview: result.stdoutPreview,
        stdout_truncated: result.stdoutTruncated,
        stdout_total_bytes: result.stdoutTotalBytes,
        stderr_preview: result.stderrPreview,
        stderr_truncated: result.stderrTruncated,
        stderr_total_bytes: result.stderrTotalBytes,
        cwd: result.cwd,
        duration_ms: result.durationMs,
      });
    }
    return JSON.stringify({
      ok: false,
      error: result.error,
      message: result.message,
      output_id: result.outputId ?? null,
      stdout_preview: result.stdoutPreview ?? "",
      stderr_preview: result.stderrPreview ?? "",
      exit_code: result.exitCode ?? null,
      signal: result.signal ?? null,
      cwd: result.cwd ?? null,
      duration_ms: result.durationMs ?? null,
    });
  }
}
