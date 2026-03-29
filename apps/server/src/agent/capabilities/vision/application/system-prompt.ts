import { renderServerStaticTemplate } from "../../../../common/runtime/read-static-text.js";

export function createVisionSystemPrompt(): string {
  return renderServerStaticTemplate(import.meta.url, "prompts/vision-system.hbs").trim();
}
