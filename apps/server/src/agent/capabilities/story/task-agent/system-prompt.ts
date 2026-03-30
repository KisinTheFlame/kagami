import { renderServerStaticTemplate } from "../../../../common/runtime/read-static-text.js";

export function createStoryAgentSystemPrompt(): string {
  return renderServerStaticTemplate(import.meta.url, "prompts/story-agent-system.hbs").trim();
}
