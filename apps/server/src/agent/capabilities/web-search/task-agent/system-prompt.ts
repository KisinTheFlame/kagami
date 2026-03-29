import { renderServerStaticTemplate } from "../../../../common/runtime/read-static-text.js";

export function createWebSearchSystemPrompt(): string {
  return renderServerStaticTemplate(import.meta.url, "prompts/web-search-system.hbs").trim();
}
