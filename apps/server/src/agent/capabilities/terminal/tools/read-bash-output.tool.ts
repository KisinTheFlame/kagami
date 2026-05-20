import { z } from "zod";
import { ZodToolComponent, type ToolKind } from "@kagami/agent-runtime";
import type { TerminalService } from "../application/terminal.service.js";

export const READ_BASH_OUTPUT_TOOL_NAME = "read_bash_output";

const ReadBashOutputArgumentsSchema = z.object({
  output_id: z.string().trim().min(1),
  stream: z.enum(["stdout", "stderr"]).default("stdout"),
  offset: z.number().int().nonnegative().optional(),
  size: z.number().int().positive().optional(),
});

export class ReadBashOutputTool extends ZodToolComponent<typeof ReadBashOutputArgumentsSchema> {
  public readonly name = READ_BASH_OUTPUT_TOOL_NAME;
  public readonly description =
    "按 output_id 分页读取之前 bash 命令的完整 stdout/stderr 内容。只能在 terminal 状态下通过 invoke 调用。适合读长输出（例如 cat 大文件、git log 多条记录）。";
  public readonly parameters = {
    type: "object",
    properties: {
      output_id: {
        type: "string",
        description: "之前 bash 工具返回的 output_id。",
      },
      stream: {
        type: "string",
        description: '要读取的流，可选 "stdout" 或 "stderr"，默认 "stdout"。',
      },
      offset: {
        type: "number",
        description: "起始字节偏移量，默认 0。越界时返回空内容且 eof=true。",
      },
      size: {
        type: "number",
        description: "本次读取的最大字节数；默认和上限均由服务端配置决定。",
      },
    },
    required: ["output_id"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = ReadBashOutputArgumentsSchema;
  // TerminalService 由所属 TerminalApp 在 onStartup 阶段实例化，所以这里用闭包延迟取，
  // 不在工具构造期就要求拿到实例。
  private readonly getTerminalService: () => TerminalService;

  public constructor({ getTerminalService }: { getTerminalService: () => TerminalService }) {
    super();
    this.getTerminalService = getTerminalService;
  }

  protected async executeTyped(
    input: z.infer<typeof ReadBashOutputArgumentsSchema>,
  ): Promise<string> {
    const result = await this.getTerminalService().readOutput({
      outputId: input.output_id,
      stream: input.stream,
      offset: input.offset,
      size: input.size,
    });
    if (result.ok) {
      return JSON.stringify({
        ok: true,
        output_id: result.outputId,
        stream: result.stream,
        offset: result.offset,
        size: result.size,
        total_bytes: result.totalBytes,
        next_offset: result.nextOffset,
        eof: result.eof,
        content: result.content,
      });
    }
    return JSON.stringify({
      ok: false,
      error: result.error,
      message: result.message,
    });
  }
}
