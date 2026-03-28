import { readServerStaticText } from "../../../../common/runtime/read-static-text.js";

const rawSystemPrompt = readServerStaticText(import.meta.url, "web-search-system.txt");

export function createWebSearchSystemPrompt(): string {
  return rawSystemPrompt.trim();
}
