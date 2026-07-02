import type { LlmMessage } from "@kagami/llm-client";

/**
 * 从主上下文消息列表取尾部约 `keepRecent` 条的平衡切片：起点强制落在 user 消息上，
 * 保证 assistant tool_call 与 tool result 成对出现——切出悬空 tool 消息会让 provider
 * 直接 400。纯函数，喂给 inner-voice Operation 做「最近真实经历」素材。
 */
export function sliceRecentBalancedMessages(
  messages: readonly LlmMessage[],
  keepRecent: number,
): LlmMessage[] {
  let start = Math.max(0, messages.length - keepRecent);
  while (start > 0 && messages[start].role !== "user") {
    start -= 1;
  }
  while (start < messages.length && messages[start].role !== "user") {
    start += 1;
  }
  return messages.slice(start);
}
