import { readFileSync } from "node:fs";

const rawSummarizerPrompt = readFileSync(
  new URL("./prompts/context-summarizer.txt", import.meta.url),
  "utf8",
).trim();

export function createContextSummarizerSystemPrompt(systemPrompt: string): string {
  return [systemPrompt.trim(), rawSummarizerPrompt].join("\n\n");
}
