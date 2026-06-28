import { renderServerStaticTemplate } from "@kagami/server-core/common/runtime/read-static-text";

export function createVisionSystemPrompt(): string {
  return renderServerStaticTemplate(import.meta.url, "prompts/vision-system.hbs").trim();
}
