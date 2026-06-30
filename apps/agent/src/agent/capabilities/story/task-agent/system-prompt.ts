import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";

export function createStoryAgentSystemPrompt(): string {
  return renderServerStaticTemplate(import.meta.url, "prompts/story-agent-system.hbs").trim();
}
