import type {
  JsonSchema,
  ToolComponent,
  ToolContext,
  Tool,
  ToolExecutionResult,
  ToolKind,
} from "./tool-component.js";

/**
 * 把一个真实工具包装成"对 LLM 字节相等、对运行时软拒绝"的代理。
 *
 * 用途：在两个 agent 之间共享一份 LLM 工具定义以维持 prompt cache 前缀字节
 * 相等，但其中一个 agent 不应该真正执行某些工具时（典型场景：task agent 克隆
 * 主 Agent 的顶层工具集，但 switch / wait 这些会改主 Agent session 的
 * 工具必须被隔离），用 OutOfScopeTool 套住。
 *
 * 对外暴露的 name / description / parameters / llmTool 与 inner 完全一致——
 * 关键不变量，否则 LLM API 的 tools 字段不再字节相等，cache 不命中。execute
 * 永远返回 OUT_OF_SCOPE，附带 reason 让 LLM 自然回到允许的调用路径。
 */
export class OutOfScopeTool implements ToolComponent {
  public readonly name: string;
  public readonly description: string | undefined;
  public readonly parameters: JsonSchema;
  public readonly kind: ToolKind;
  private readonly reason: string;

  public constructor({
    inner,
    reason,
  }: {
    inner: ToolComponent;
    /** 软拒绝时回带给 LLM 的具体原因。形如 "在网页搜索子任务里不能调用 switch"。 */
    reason: string;
  }) {
    this.name = inner.name;
    this.description = inner.description;
    this.parameters = inner.parameters;
    this.kind = inner.kind;
    this.reason = reason;
  }

  public get llmTool(): Tool {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
    };
  }

  public async execute(
    _argumentsValue: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolExecutionResult> {
    return {
      content: JSON.stringify({
        ok: false,
        error: "OUT_OF_SCOPE",
        tool: this.name,
        message: this.reason,
      }),
    };
  }
}
