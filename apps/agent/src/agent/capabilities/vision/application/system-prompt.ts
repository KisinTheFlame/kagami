import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";

export function createVisionSystemPrompt(): string {
  return renderServerStaticTemplate(import.meta.url, "prompts/vision-system.hbs").trim();
}
