import type { ToolContext } from "./tool-component.js";

/**
 * Invoke 子工具的所有者协议。
 *
 * 一个 invoke 子工具背后总有一个具体的所有者模块——某个 App、某个状态树节点、
 * 未来某种全局服务。所有者负责两件事：
 *
 *   1. 声明它拥有哪些工具（ownsTool）
 *   2. 在当前 runtime context 下判断这些工具能不能调用（canInvokeNow）
 *
 * InvokeTool 收到 invoke 请求时不再做任何 ad-hoc 检查，而是：
 *   - 先用 ownsTool 在 owners 列表里找到所有者
 *   - 让所有者通过 canInvokeNow 给出 gate 决策
 *   - ok 就执行，not ok 就把所有者给的错误返回给 Kagami
 *
 * 这条 dispatcher 主路径取代了之前"两套并行 gate（状态树 availableTools +
 * AppManager.canInvoke）按顺序串联检查"的 bolt-on 设计，避免不同所有者之间
 * 的 gate 互相误挡。
 */
export interface InvokeSubtoolOwner {
  /** 这个所有者是否拥有名为 toolName 的工具。 */
  ownsTool(toolName: string): boolean;

  /**
   * 在当前 runtime context 下能否调用 toolName。
   *
   * 调用前提：调用方已经 confirmed ownsTool(toolName) 为 true。所有者可以信任
   * 自己拥有这个工具，无需再 double-check。
   */
  canInvokeNow(toolName: string, ctx: ToolContext): SubtoolGuardResult;
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
