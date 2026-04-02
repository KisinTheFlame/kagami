import { renderServerStaticTemplate } from "../../../../common/runtime/read-static-text.js";

export type ContextSummarizerPromptProfile = "root" | "story";

export function createContextSummarizerSystemPrompt(
  profile: ContextSummarizerPromptProfile,
): string {
  const templatePath =
    profile === "story"
      ? "prompts/story-context-summarizer-system.hbs"
      : "prompts/root-context-summarizer-system.hbs";

  return renderServerStaticTemplate(import.meta.url, templatePath).trim();
}

export function createRootContextSummarizerSystemPrompt(): string {
  return createContextSummarizerSystemPrompt("root");
}

export function createStoryContextSummarizerSystemPrompt(): string {
  return createContextSummarizerSystemPrompt("story");
}
