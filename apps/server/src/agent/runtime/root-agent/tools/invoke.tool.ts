import { z } from "zod";
import {
  ToolCatalog,
  type JsonSchema,
  type ToolComponent,
  type ToolContext,
  type ToolDefinition,
  type ToolExecutor,
  type ToolExecutionResult,
  type ToolKind,
  ZodToolComponent,
} from "@kagami/agent-runtime";
import type { RootAgentSessionController } from "../session/root-agent-session.js";
import { renderInvokeToolGuide } from "./invoke-tool-docs.js";

export const INVOKE_TOOL_NAME = "invoke";

const InvokeArgumentsSchema = z
  .object({
    tool: z.string().trim().min(1),
  })
  .passthrough();

type InvokeToolContext = ToolContext & {
  rootAgentSession?: RootAgentSessionController;
};

export class InvokeTool extends ZodToolComponent<typeof InvokeArgumentsSchema> {
  public readonly name = INVOKE_TOOL_NAME;
  public readonly description =
    "调用当前状态下可用的动态子工具，例如群聊里的 send_message、IT 之家的 open_ithome_article 或神游里的 zone_out。";
  public readonly parameters: JsonSchema;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = InvokeArgumentsSchema;
  private readonly invokeToolSet: ToolExecutor;
  private readonly invokeToolNames: Set<string>;
  private readonly invokeToolDefinitionByName: ReadonlyMap<string, ToolDefinition>;

  public constructor({ tools }: { tools: ToolComponent[] }) {
    super();
    this.parameters = buildInvokeParameters(tools);
    this.invokeToolSet = new ToolCatalog(tools).pick(tools.map(tool => tool.name));
    this.invokeToolNames = new Set(tools.map(tool => tool.name));
    this.invokeToolDefinitionByName = new Map(tools.map(tool => [tool.name, tool.llmTool]));
  }

  protected async executeTyped(
    input: z.infer<typeof InvokeArgumentsSchema>,
    context: ToolContext,
  ): Promise<ToolExecutionResult> {
    const rootAgentSession = (context as InvokeToolContext).rootAgentSession;
    if (!rootAgentSession) {
      return {
        content: JSON.stringify({
          ok: false,
          error: "SESSION_UNAVAILABLE",
          message: "当前会话不可用，暂时无法调用 invoke 子工具。",
          availableTools: [],
        }),
        signal: "continue",
      };
    }

    const state = rootAgentSession.getState();
    const availableTools = rootAgentSession.getAvailableInvokeTools();
    if (!this.invokeToolNames.has(input.tool)) {
      const availableToolDefinitions = this.getToolDefinitionsByNames(availableTools);
      return {
        content: JSON.stringify({
          ok: false,
          error: "INVOKE_TOOL_NOT_FOUND",
          tool: input.tool,
          message: buildInvokeToolNotFoundMessage({
            tool: input.tool,
            availableToolDefinitions,
          }),
          availableTools,
        }),
        signal: "continue",
      };
    }

    if (!availableTools.includes(input.tool as (typeof availableTools)[number])) {
      const availableToolDefinitions = this.getToolDefinitionsByNames(availableTools);
      return {
        content: JSON.stringify({
          ok: false,
          error: "INVOKE_TOOL_NOT_AVAILABLE",
          tool: input.tool,
          state: state.waiting ? "waiting" : state.focusedStateId,
          message: buildInvokeToolUnavailableMessage({
            tool: input.tool,
            state: state.waiting ? "waiting" : state.focusedStateId,
            availableToolDefinitions,
          }),
          availableTools,
        }),
        signal: "continue",
      };
    }

    const { tool, ...toolArguments } = input;
    const result = await this.invokeToolSet.execute(tool, toolArguments, context);
    return {
      ...result,
      content: normalizeInvokeFailureContent({
        tool,
        content: result.content,
        availableTools,
        currentToolDefinition: this.invokeToolDefinitionByName.get(tool),
      }),
    };
  }

  private getToolDefinitionsByNames(toolNames: string[]): ToolDefinition[] {
    return toolNames
      .map(toolName => this.invokeToolDefinitionByName.get(toolName))
      .filter((definition): definition is ToolDefinition => definition !== undefined);
  }
}

function buildInvokeParameters(tools: ToolComponent[]): JsonSchema {
  const properties: Record<string, unknown> = {
    tool: {
      type: "string",
      description: '要调用的子工具名，例如 "send_message"、"open_ithome_article" 或 "zone_out"。',
    },
  };

  for (const tool of tools) {
    for (const [propertyName, propertySchema] of Object.entries(tool.parameters.properties)) {
      if (propertyName === "tool") {
        throw new Error(`Invoke 子工具 ${tool.name} 不能声明保留参数名 tool`);
      }

      if (propertyName in properties) {
        throw new Error(`Invoke 子工具参数名冲突: ${propertyName}`);
      }

      properties[propertyName] = appendInvokePropertyDescription({
        toolName: tool.name,
        propertySchema,
      });
    }
  }

  return {
    type: "object",
    properties,
  };
}

function appendInvokePropertyDescription(input: {
  toolName: string;
  propertySchema: unknown;
}): unknown {
  if (!isRecord(input.propertySchema)) {
    return input.propertySchema;
  }

  const descriptionPrefix = `仅 ${input.toolName} 使用。`;
  const description = input.propertySchema.description;

  return {
    ...input.propertySchema,
    description:
      typeof description === "string" && description.length > 0
        ? `${descriptionPrefix}${description}`
        : descriptionPrefix,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildInvokeToolNotFoundMessage(input: {
  tool: string;
  availableToolDefinitions: ToolDefinition[];
}): string {
  return [
    `invoke 子工具 ${input.tool} 不存在。`,
    buildAvailableInvokeToolsDescription(input.availableToolDefinitions),
  ].join("\n");
}

function buildInvokeToolUnavailableMessage(input: {
  tool: string;
  state: string;
  availableToolDefinitions: ToolDefinition[];
}): string {
  return [
    `invoke 子工具 ${input.tool} 不能在当前状态 ${input.state} 下调用。`,
    buildAvailableInvokeToolsDescription(input.availableToolDefinitions),
  ].join("\n");
}

function normalizeInvokeFailureContent(input: {
  tool: string;
  content: string;
  availableTools: string[];
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
      availableTools: input.availableTools,
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

  if (input.error === "GROUP_CONTEXT_UNAVAILABLE") {
    return appendInvokeToolDefinitionMessage(
      `当前缺少可发消息的群聊上下文，不能调用 ${input.tool}。`,
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

function buildAvailableInvokeToolsDescription(availableToolDefinitions: ToolDefinition[]): string {
  if (availableToolDefinitions.length === 0) {
    return "当前状态没有可用的 invoke 子工具。";
  }

  return `当前状态可用的 invoke 工具说明：\n${renderInvokeToolGuide(availableToolDefinitions)}`;
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
