import { type LlmChatCallStatus } from "@kagami/shared/schemas/llm-chat";

export function toStatusLabel(status: LlmChatCallStatus): string {
  return status === "success" ? "成功" : "失败";
}
