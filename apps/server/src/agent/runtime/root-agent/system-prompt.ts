import type { ToolDefinition } from "@kagami/agent-runtime";
import { renderServerStaticTemplate } from "../../../common/runtime/read-static-text.js";
import { renderInvokeToolGuide } from "./tools/invoke-tool-docs.js";

export function createAgentSystemPrompt({
  botQQ,
  creatorName,
  creatorQQ,
  invokeToolDefinitions,
}: {
  botQQ: string;
  creatorName: string;
  creatorQQ: string;
  invokeToolDefinitions: ToolDefinition[];
}): string {
  return renderServerStaticTemplate(import.meta.url, "prompts/main-engine-system.hbs", {
    botQQ,
    creatorName,
    creatorQQ,
    invokeToolGuide: renderInvokeToolGuide(invokeToolDefinitions, {
      includeApplicableStates: true,
    }),
  }).trim();
}
