import type { ToolDefinition } from "@kagami/agent-runtime";

export function renderInvokeToolGuide(
  tools: ToolDefinition[],
  options: {
    includeApplicableStates: boolean;
  } = {
    includeApplicableStates: false,
  },
): string {
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

      if (options.includeApplicableStates) {
        lines.push(`  - 适用状态：\`${getInvokeToolApplicableStateText(tool.name)}\``);
      }

      return lines.join("\n");
    })
    .join("\n");
}

function renderInvokeToolParameterLines(tool: ToolDefinition): string[] {
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

function getInvokeToolApplicableStateText(toolName: string): string {
  if (toolName === "send_message") {
    return "qq_group:* | qq_private:*";
  }

  if (toolName === "open_ithome_article") {
    return "ithome";
  }

  if (toolName === "zone_out") {
    return "zone_out";
  }

  return "未知";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
