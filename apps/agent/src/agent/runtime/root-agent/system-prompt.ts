import { renderServerStaticTemplate } from "@kagami/server-core/common/runtime/read-static-text";

export function createAgentSystemPrompt({
  botQQ,
  creatorName,
  creatorQQ,
}: {
  botQQ: string;
  creatorName: string;
  creatorQQ: string;
}): string {
  return renderServerStaticTemplate(import.meta.url, "prompts/main-engine-system.hbs", {
    botQQ,
    creatorName,
    creatorQQ,
  }).trim();
}
