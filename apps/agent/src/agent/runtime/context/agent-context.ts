import type { LlmMessage } from "@kagami/llm-client";
import type { PersistedAgentContextSnapshot } from "../root-agent/persistence/root-agent-runtime-snapshot.js";

export type AssistantMessage = Extract<LlmMessage, { role: "assistant" }>;
export type AgentContextDashboardItem = {
  kind: "llm_message";
  label: string;
  preview: string;
  truncated: boolean;
};
export type AgentContextDashboardSummary = {
  messageCount: number;
  recentItems: AgentContextDashboardItem[];
  recentItemsTruncated: boolean;
};
type ContextLlmMessageItem = {
  kind: "llm_message";
  message: LlmMessage;
};
export type ContextItem = ContextLlmMessageItem;

export type AgentContextSnapshot = {
  systemPrompt: string;
  messages: LlmMessage[];
};

export interface AgentContext {
  /**
   * 单调递增的修订号：每次改动消息列表（append / replaceLeading / reset / restore）都 +1，只读操作不变。
   * 供持久化侧 O(1) 判断「自上次落库以来有没有变过」，替代对整条上下文做 O(n) 的 JSON.stringify 指纹。
   * 只保证「变了就变号」，不保证语义等价的两次改动号不同——用作变更信号，不用作内容等价判据。
   */
  getRevision(): number;
  getSnapshot(): Promise<AgentContextSnapshot>;
  /**
   * 只读窥视上下文尾部的最后一条 message；空上下文返回 null。供起轮前的角色交替不变量
   * 检查用（尾部是 assistant 时须补一条 user 轮，否则纯文本轮 + 空闲自唤醒会造成连续
   * assistant → provider 400）。O(1)，不克隆整表。
   */
  getLastMessage(): Promise<LlmMessage | null>;
  fork(): Promise<AgentContext>;
  exportPersistedSnapshot(): Promise<PersistedAgentContextSnapshot>;
  restorePersistedSnapshot(snapshot: PersistedAgentContextSnapshot): Promise<void>;
  reset(): Promise<void>;
  appendMessages(messages: LlmMessage[]): Promise<void>;
  appendAssistantTurn(message: AssistantMessage): Promise<void>;
  appendToolResult(input: { toolCallId: string; content: string }): Promise<void>;
  /**
   * 把最前面的 `count` 条 message 替换成 `replacement`。上下文压缩的"计划性重建"用——
   * 破坏 KV 缓存前缀，仅压缩路径应调用。`count` 超过总 message 数会抛错。
   */
  replaceLeadingMessages(count: number, replacement: LlmMessage[]): Promise<void>;
  getDashboardSummary(input?: {
    limit?: number;
    previewLength?: number;
  }): Promise<AgentContextDashboardSummary>;
}
