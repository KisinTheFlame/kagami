import type { z } from "zod";
import {
  ZodToolComponent,
  type JsonSchema,
  type ToolContext,
  type ToolKind,
} from "./tool-component.js";
import type { AsyncTaskManager, AsyncTaskRunResult } from "../async-task-manager.js";

/**
 * 异步工具的同步准备结果：
 * - `reject`：同步短路（如前置门控不通过），content 原样作为 tool_result 返回，不发起异步任务。
 * - `submit`：提供后台要跑的 thunk，由 AsyncTool 交给 AsyncTaskManager。thunk 可回纯文本或带图结构
 *   （`AsyncTaskRunResult`），带图时结果回流会拼成多模态消息。
 */
export type AsyncToolPreparation =
  | { readonly kind: "reject"; readonly content: string }
  | { readonly kind: "submit"; readonly run: () => Promise<AsyncTaskRunResult> };

export type AsyncToolConfig<TInput extends z.ZodTypeAny> = {
  name: string;
  description: string;
  parameters: JsonSchema;
  inputSchema: TInput;
  /** 默认 "business"。 */
  kind?: ToolKind;
  asyncTaskManager: AsyncTaskManager;
  /** 同步门控 + 提供 thunk。近乎纯函数，独立可测。 */
  prepareAsync: (input: z.infer<TInput>, context: ToolContext) => AsyncToolPreparation;
};

/**
 * 框架级异步工具装配器（**组合而非继承**）。
 *
 * 具体类、直接 `new`、不被继承：把工具唯一的变化点 `prepareAsync` 作为**注入的函数**接收，
 * 自己独占 `executeTyped`（submit + 产占位）。工具作者拿不到占位的产出点——这是
 * 「占位由框架统一产出、工具无权自定义」的**结构性**保证（不靠约定，也避开 TS 无 `final`）。
 *
 * 与 `wait` 工具同构：工具不实现协议本体，只声明意图（reject / submit），由框架统一产出占位。
 */
export class AsyncTool<TInput extends z.ZodTypeAny> extends ZodToolComponent<TInput> {
  public readonly name: string;
  public readonly description: string;
  public readonly parameters: JsonSchema;
  public readonly kind: ToolKind;
  protected readonly inputSchema: TInput;
  private readonly asyncTaskManager: AsyncTaskManager;
  private readonly prepare: (input: z.infer<TInput>, context: ToolContext) => AsyncToolPreparation;

  public constructor(config: AsyncToolConfig<TInput>) {
    super();
    this.name = config.name;
    this.description = config.description;
    this.parameters = config.parameters;
    this.kind = config.kind ?? "business";
    this.inputSchema = config.inputSchema;
    this.asyncTaskManager = config.asyncTaskManager;
    this.prepare = config.prepareAsync;
  }

  protected executeTyped(input: z.infer<TInput>, context: ToolContext): string {
    const prepared = this.prepare(input, context);
    if (prepared.kind === "reject") {
      return prepared.content;
    }
    const { taskId } = this.asyncTaskManager.submit({ toolName: this.name, run: prepared.run });
    return formatAsyncTaskSubmitted(taskId, this.name);
  }
}

/**
 * 中心化占位格式：纯结构化标签，无文案。含义在调用方 Agent 的 system prompt 里讲一次。
 * 这是异步工具协议唯一的占位产出点。
 */
export function formatAsyncTaskSubmitted(taskId: string, toolName: string): string {
  return `<async_task_submitted task_id="${taskId}" tool="${toolName}" />`;
}
