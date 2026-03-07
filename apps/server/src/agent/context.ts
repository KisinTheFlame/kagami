import { readFileSync } from "node:fs";

export const AGENT_SYSTEM_PROMPT = readFileSync(
  new URL("./prompts/system.txt", import.meta.url),
  "utf8",
).trim();
