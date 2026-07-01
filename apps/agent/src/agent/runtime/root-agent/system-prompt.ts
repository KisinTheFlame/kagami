import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";

export function createAgentSystemPrompt({ creatorName }: { creatorName: string }): string {
  // QQ 相关（botQQ / creatorQQ / 群聊场景与行为）已全部下沉到 QQ App 的 help，主 system prompt
  // 只保留与平台无关的身份与手机 OS 说明。这里只需要创造者名字。
  return renderServerStaticTemplate(import.meta.url, "prompts/main-engine-system.hbs", {
    creatorName,
  }).trim();
}
