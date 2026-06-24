import { z } from "zod";
import {
  type InvokeSubtoolOwner,
  type JsonSchema,
  type ToolContext,
  type ToolDefinition,
  type ToolExecutionResult,
  type ToolKind,
  ZodToolComponent,
} from "@kagami/agent-runtime";
import { renderInvokeToolGuide } from "./invoke-tool-docs.js";

export const INVOKE_TOOL_NAME = "invoke";

const InvokeArgumentsSchema = z
  .object({
    tool: z.string().trim().min(1),
  })
  .passthrough();

/**
 * InvokeTool 是顶层工具集里 dispatcher 的位置。它本身不持有任何子工具集合、
 * 不知道任何 session / state / app / scope 这些业务概念。所有这些都被收敛到
 * 一组 InvokeSubtoolOwner 里：每个 owner 负责自己旗下子工具的拥有声明、当前
 * 上下文是否可调、以及实际执行。
 *
 * 构造期 InvokeTool 遍历 owners 的 listOwnedTools 摊平成一张 (name → owner)
 * 索引，重复声明的工具名直接抛错。运行期就是按这张索引找 owner → owner
 * gate → owner execute 三步。
 *
 * 暴露给 LLM 的 schema 是稳定常量（只声明 tool 字段，其余走 additionalProperties）。
 * 这条不变量配合 owner-driven dispatch 一起，让"主 Agent 和 task agent 各自挂
 * 不同 owner 列表的 InvokeTool 实例"产出字节相等的 LLM 工具定义，保住 KV
 * cache 命中前提。
 */
export class InvokeTool extends ZodToolComponent<typeof InvokeArgumentsSchema> {
  public readonly name = INVOKE_TOOL_NAME;
  public readonly description =
    "调用一个动态子工具。子工具名通过 tool 字段指定，其余字段按目标子工具自身的参数规约传入。子工具的清单和参数说明不在 system prompt 里固定枚举；如果调错或不熟悉，错误返回里会包含当前可用工具的说明。";
  public readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      tool: {
        type: "string",
        description: "要调用的子工具名。",
      },
    },
    additionalProperties: true,
  };
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = InvokeArgumentsSchema;

  private readonly owners: readonly InvokeSubtoolOwner[];
  private readonly ownerByToolName: ReadonlyMap<string, InvokeSubtoolOwner>;
  private readonly definitionByToolName: ReadonlyMap<string, ToolDefinition>;

  public constructor({ owners }: { owners: readonly InvokeSubtoolOwner[] }) {
    super();
    const ownerByToolName = new Map<string, InvokeSubtoolOwner>();
    const definitionByToolName = new Map<string, ToolDefinition>();
    for (const owner of owners) {
      for (const definition of owner.listOwnedTools()) {
        if (ownerByToolName.has(definition.name)) {
          throw new Error(
            `Invoke 子工具 ${definition.name} 被多个 owner 同时声明，请检查 InvokeTool 装配。`,
          );
        }
        ownerByToolName.set(definition.name, owner);
        definitionByToolName.set(definition.name, definition);
      }
    }
    this.owners = owners;
    this.ownerByToolName = ownerByToolName;
    this.definitionByToolName = definitionByToolName;
  }

  protected async executeTyped(
    input: z.infer<typeof InvokeArgumentsSchema>,
    context: ToolContext,
  ): Promise<ToolExecutionResult> {
    const owner = this.ownerByToolName.get(input.tool);
    // 子工具「不存在」和「当前不允许调用」统一按不存在处理：对 LLM 而言两者都是
    // "这个工具现在不可用"，回带当前真正可调的工具清单让它改投，不再区分 guard 原因。
    if (!owner || !owner.canInvokeNow(input.tool, context).ok) {
      const availableToolDefinitions = this.listInvocableDefinitions(context);
      return {
        content: JSON.stringify({
          ok: false,
          error: "INVOKE_TOOL_NOT_FOUND",
          tool: input.tool,
          message: buildInvokeToolNotFoundMessage({
            tool: input.tool,
            availableToolDefinitions,
          }),
          availableTools: availableToolDefinitions.map(definition => definition.name),
        }),
      };
    }

    const { tool, ...toolArguments } = input;
    const result = await owner.execute(tool, toolArguments, context);
    return {
      ...result,
      content: enrichSubtoolFailureContent({
        tool,
        content: result.content,
        currentToolDefinition: this.definitionByToolName.get(tool),
      }),
    };
  }

  /**
   * 当前 runtime context 下真正可调的子工具定义。NOT_FOUND 回带的可用清单走这里，
   * 这样「不存在」和「不允许调用」合并后，被拒的工具自然不会出现在清单里，
   * 不会出现"说它不存在却又列在可用里"的自相矛盾。
   */
  private listInvocableDefinitions(context: ToolContext): readonly ToolDefinition[] {
    const definitions: ToolDefinition[] = [];
    for (const owner of this.owners) {
      for (const definition of owner.listOwnedTools()) {
        if (owner.canInvokeNow(definition.name, context).ok) {
          definitions.push(definition);
        }
      }
    }
    return definitions;
  }
}

function buildInvokeToolNotFoundMessage(input: {
  tool: string;
  availableToolDefinitions: readonly ToolDefinition[];
}): string {
  return [
    `invoke 子工具 ${input.tool} 不存在。`,
    buildAvailableInvokeToolsDescription(input.availableToolDefinitions),
  ].join("\n");
}

/**
 * 当 owner.execute 直接吐出失败内容（典型：ZodToolComponent 的 INVALID_ARGUMENTS、
 * 或者子工具自身业务失败）时，把当前子工具的 schema 补在 message 末尾，让 LLM
 * 下一轮能照着 schema 修正参数。
 *
 * 这条路径只补 docs，不再像旧版那样塞 availableTools 字段——owner.canInvokeNow
 * 那一支才是负责"提示别的可选项"的地方，本路径只关心当前这个工具怎么调。
 */
function enrichSubtoolFailureContent(input: {
  tool: string;
  content: string;
  currentToolDefinition?: ToolDefinition;
}): string {
  try {
    const parsed = JSON.parse(input.content) as Record<string, unknown>;
    const looksLikeFailure =
      parsed.ok === false || (typeof parsed.error === "string" && parsed.error.length > 0);
    if (!looksLikeFailure) {
      return input.content;
    }

    return JSON.stringify({
      ...parsed,
      message:
        typeof parsed.message === "string"
          ? appendInvokeToolDefinitionMessage(parsed.message, input.currentToolDefinition)
          : buildInvokeSubtoolFailureMessage({
              tool: input.tool,
              error: typeof parsed.error === "string" ? parsed.error : undefined,
              details: Array.isArray(parsed.details)
                ? parsed.details.filter((item): item is string => typeof item === "string")
                : [],
              currentToolDefinition: input.currentToolDefinition,
            }),
    });
  } catch {
    return input.content;
  }
}

function buildInvokeSubtoolFailureMessage(input: {
  tool: string;
  error?: string;
  details: string[];
  currentToolDefinition?: ToolDefinition;
}): string {
  if (input.error === "INVALID_ARGUMENTS") {
    const detailsText = input.details.length > 0 ? ` ${input.details.join("；")}` : "";
    return appendInvokeToolDefinitionMessage(
      `invoke 子工具 ${input.tool} 参数不合法。${detailsText}`.trim(),
      input.currentToolDefinition,
    );
  }

  if (input.error === "CHAT_CONTEXT_UNAVAILABLE") {
    return appendInvokeToolDefinitionMessage(
      `当前缺少可发消息的 QQ 会话上下文，不能调用 ${input.tool}。`,
      input.currentToolDefinition,
    );
  }

  if (input.error === "ARTICLE_NOT_FOUND") {
    return appendInvokeToolDefinitionMessage(
      "当前 IT 之家列表中找不到该文章 ID。",
      input.currentToolDefinition,
    );
  }

  if (input.error) {
    return appendInvokeToolDefinitionMessage(
      `invoke 子工具 ${input.tool} 调用失败：${input.error}。`,
      input.currentToolDefinition,
    );
  }

  return appendInvokeToolDefinitionMessage(
    `invoke 子工具 ${input.tool} 调用失败。`,
    input.currentToolDefinition,
  );
}

function buildAvailableInvokeToolsDescription(
  availableToolDefinitions: readonly ToolDefinition[],
): string {
  if (availableToolDefinitions.length === 0) {
    return "当前没有可用的 invoke 子工具。";
  }

  return `当前可用的 invoke 工具说明：\n${renderInvokeToolGuide(availableToolDefinitions)}`;
}

function appendInvokeToolDefinitionMessage(
  baseMessage: string,
  currentToolDefinition?: ToolDefinition,
): string {
  if (!currentToolDefinition) {
    return baseMessage;
  }

  return `${baseMessage}\n当前子工具说明：\n${renderInvokeToolGuide([currentToolDefinition])}`;
}
