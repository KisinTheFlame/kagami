import { readFileSync } from "node:fs";

const rawSystemPrompt = readFileSync(new URL("./prompts/system.txt", import.meta.url), "utf8");

export function createVisionSystemPrompt(): string {
  return rawSystemPrompt.trim();
}
