import Handlebars from "handlebars";
import { readServerStaticText } from "../../../common/runtime/read-static-text.js";

const rawSystemPrompt = readServerStaticText(import.meta.url, "main-engine-system.txt");
const compileSystemPrompt = Handlebars.compile(rawSystemPrompt);

export function createAgentSystemPrompt({
  botQQ,
  creatorName,
  creatorQQ,
}: {
  botQQ: string;
  creatorName: string;
  creatorQQ: string;
}): string {
  return compileSystemPrompt({
    botQQ,
    creatorName,
    creatorQQ,
  }).trim();
}
