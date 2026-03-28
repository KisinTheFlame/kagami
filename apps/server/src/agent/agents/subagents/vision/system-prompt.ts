import { readServerStaticText } from "../../../../common/runtime/read-static-text.js";

const rawSystemPrompt = readServerStaticText(import.meta.url, "vision-system.txt");

export function createVisionSystemPrompt(): string {
  return rawSystemPrompt.trim();
}
