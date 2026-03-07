import { readFileSync } from "node:fs";
import Handlebars from "handlebars";

import { env } from "../env.js";

const rawSystemPrompt = readFileSync(new URL("./prompts/system.txt", import.meta.url), "utf8");

const compileSystemPrompt = Handlebars.compile(rawSystemPrompt);

export const AGENT_SYSTEM_PROMPT = compileSystemPrompt({
  botQQ: env.BOT_QQ,
}).trim();
