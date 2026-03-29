import { renderServerStaticTemplate } from "../../../../common/runtime/read-static-text.js";

export function createContextSummarizerSystemPrompt(): string {
  return renderServerStaticTemplate(
    import.meta.url,
    "prompts/context-summarizer-system.hbs",
  ).trim();
}
