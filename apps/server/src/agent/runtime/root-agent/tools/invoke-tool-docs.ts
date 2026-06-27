import type { Tool } from "@kagami/agent-runtime";
import { isRecord } from "@kagami/server-core/common/prisma-json";

export function renderInvokeToolGuide(tools: readonly Tool[]): string {
  return tools
    .map(tool => {
      const lines = [`- \`${tool.name}\`: ${tool.description ?? "无说明。"}`];
      const parameterLines = renderInvokeToolParameterLines(tool);

      if (parameterLines.length === 0) {
        lines.push("  - 参数：无");
      } else {
        lines.push("  - 参数：");
        for (const parameterLine of parameterLines) {
          lines.push(`    - ${parameterLine}`);
        }
      }

      return lines.join("\n");
    })
    .join("\n");
}

function renderInvokeToolParameterLines(tool: Tool): string[] {
  return Object.entries(tool.parameters.properties)
    .filter(([parameterName]) => parameterName !== "tool")
    .map(([parameterName, propertySchema]) => {
      if (!isRecord(propertySchema)) {
        return `\`${parameterName}\``;
      }

      const propertyType =
        typeof propertySchema.type === "string" && propertySchema.type.length > 0
          ? ` (${propertySchema.type})`
          : "";
      const description =
        typeof propertySchema.description === "string" && propertySchema.description.length > 0
          ? `：${propertySchema.description}`
          : "";

      return `\`${parameterName}\`${propertyType}${description}`;
    });
}
