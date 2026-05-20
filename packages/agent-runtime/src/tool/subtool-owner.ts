import type { ToolContext, ToolDefinition, ToolExecutionResult } from "./tool-component.js";

/**
 * Invoke 子工具的所有者协议。
 *
 * 一个 invoke 子工具背后总有一个具体的所有者模块——某个 App、某个状态树节点、
 * 某个 task agent。所有者全权负责自己旗下子工具的三件事：
 *
 *   1. 声明拥有哪些工具（listOwnedTools）—— 同时给 InvokeTool 用于失败回带 docs
 *   2. 在当前 runtime context 下判断这些工具能不能调（canInvokeNow）
 *   3. 真正执行这些工具（execute）
 *
 * InvokeTool 收到一次 invoke 请求时退化为纯 dispatcher：
 *   - 构造期把 owners 的 listOwnedTools 摊平成 (name → owner) 索引，重复声明直接抛错
 *   - 运行期按 name 找到 owner → 让 owner gate → 让 owner 执行
 *
 * 关键设计：InvokeTool 本身不再持有任何子工具集合或子工具执行器，也不再耦合
 * "session / state / scope" 这种业务概念。新增一类子工具 = 写一个新的 owner，
 * 挂到对应 agent 的 InvokeTool 实例上即可，主 Agent 视野不会被污染。
 */
export interface InvokeSubtoolOwner {
  /**
   * 本 owner 拥有的所有子工具的定义。
   *
   * 同时承担两个职责：
   * 1. 在 InvokeTool 构造期，作为 (name → owner) 索引的来源
   * 2. 在运行期 NOT_FOUND 这类错误回带 docs 时，提供子工具说明文本
   *
   * 返回数组应当在 owner 生命周期内稳定——InvokeTool 只在构造期读一次建索引。
   */
  listOwnedTools(): readonly ToolDefinition[];

  /**
   * 在当前 runtime context 下能否调 toolName。
   *
   * 调用前提：InvokeTool 已经通过构造期建好的索引确认了 toolName 属于本 owner，
   * 无需再做 ownership 校验。
   */
  canInvokeNow(toolName: string, ctx: ToolContext): SubtoolGuardResult;

  /**
   * 执行 toolName。调用前提：canInvokeNow 返回 ok。
   *
   * 返回的 ToolExecutionResult 直接作为 invoke 这次调用的结果回给上层。
   */
  execute(
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult>;
}

/**
 * 所有者对一次 invoke 请求的 gate 决策。
 *
 * - ok=true：可以执行
 * - ok=false：拒绝。error 是错误代码（"INVOKE_TOOL_APP_GUARD" / "INVOKE_TOOL_NOT_AVAILABLE"
 *   等），message 是给 Kagami 看的可操作提示，extras 是所有者想附加的诊断字段
 *   （比如状态树会附 state、availableTools 给 Kagami 看可替代选项）
 */
export type SubtoolGuardResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      message: string;
      extras?: Record<string, unknown>;
    };
