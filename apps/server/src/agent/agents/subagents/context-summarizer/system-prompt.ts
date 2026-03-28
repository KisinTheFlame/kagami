import { readFileSync } from "node:fs";

const rawSummarizerPrompt = readFileSync(
  new URL("./prompts/system.txt", import.meta.url),
  "utf8",
).trim();

export function createContextSummarizerSystemPrompt(): string {
  return rawSummarizerPrompt;
}
