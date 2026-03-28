import { readServerStaticText } from "../../../../common/runtime/read-static-text.js";

const rawSummarizerPrompt = readServerStaticText(
  import.meta.url,
  "context-summarizer-system.txt",
).trim();

export function createContextSummarizerSystemPrompt(): string {
  return rawSummarizerPrompt;
}
