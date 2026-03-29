import Handlebars from "handlebars";
import { readServerStaticText } from "../../../common/runtime/read-static-text.js";

const rawSystemPrompt = readServerStaticText(import.meta.url, "main-engine-system.txt");
const compileSystemPrompt = Handlebars.compile(rawSystemPrompt);

export function createAgentSystemPrompt({
  botQQ,
  ownerName,
  ownerQQ,
}: {
  botQQ: string;
  ownerName: string;
  ownerQQ: string;
}): string {
  return compileSystemPrompt({
    botQQ,
    ownerName,
    ownerQQ,
  }).trim();
}
