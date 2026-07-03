import { type LlmChatCallStatus } from "@kagami/console-api/llm-chat-call";

export function toStatusLabel(status: LlmChatCallStatus): string {
  return status === "success" ? "成功" : "失败";
}
