import type { AppId, Effect, ReplaceLeadingMessagesEffect } from "@kagami/agent-runtime";

/**
 * 把 content（一段字符串）以 role=user 追加到主 Agent 上下文尾部。
 * 这是工具 / App 钩子 / 事件 handler "给 Agent 一段屏幕" 的标准方式。
 */
export type AppendMessageEffect = Effect & {
  readonly type: "append_message";
  readonly content: string;
};

/**
 * 把 root agent 的 currentApp 切到 appId（null 表示回到桌面）。
 * 由 EnterTool / BackToPortalTool 产出。
 */
export type SwitchAppEffect = Effect & {
  readonly type: "switch_app";
  readonly appId: AppId | null;
};

/**
 * 把当前 Agent 主循环挂起，等待事件队列非空（或 maxWaitMs 超时由内部 wake
 * timer 唤醒）。Interpreter 在处理这个 Effect 时阻塞 await，事件到达后返回，
 * 由后续 LoopAgent 主循环正常 take 事件消费——本 Effect 不负责事件路由。
 *
 * 由 WaitTool 产出。是 Agent 状态机里"运行中 → 阻塞 → 运行中"切换的描述。
 *
 * 设计依据：[docs/effect-model.md](docs/effect-model.md) 阶段 6。
 */
export type WaitForEventEffect = Effect & {
  readonly type: "wait_for_event";
  readonly maxWaitMs: number;
};

/**
 * 主 Agent（RootLoopAgent）支持的 Effect 联合。
 *
 * 由公共 Effect（`ReplaceMessagesEffect`，来自 agent-runtime）和 RootAgent 专属
 * Effect 组成。Interpreter 由 `createRootEffectInterpreter` 组装的一组 handler
 * 解释——新增 Effect 类型需要：
 * 1. 在这里加一个分支。
 * 2. 在 createRootEffectInterpreter 里加对应 handler（公共能力优先复用 agent-runtime
 *    的公共 handler，专属能力写 RootAgent 自己的 handler）。
 * 3. 产出方（工具 / 钩子 / extension）在拼 Effect 时用新的字面量。
 *
 * 设计依据：[docs/effect-model.md](docs/effect-model.md)。
 */
export type RootAgentEffect =
  | AppendMessageEffect
  | SwitchAppEffect
  | ReplaceLeadingMessagesEffect
  | WaitForEventEffect;
