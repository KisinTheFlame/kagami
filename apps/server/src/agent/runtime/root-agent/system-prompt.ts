import { renderServerStaticTemplate } from "../../../common/runtime/read-static-text.js";

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
