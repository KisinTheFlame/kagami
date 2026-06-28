import { renderServerStaticTemplate } from "@kagami/server-core/common/runtime/read-static-text";

export function createStoryAgentSystemPrompt(): string {
  return renderServerStaticTemplate(import.meta.url, "prompts/story-agent-system.hbs").trim();
}
