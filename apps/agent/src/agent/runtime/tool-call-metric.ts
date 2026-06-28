import type { MetricService } from "../../metric/application/metric.service.js";

export const NOOP_METRIC_SERVICE: MetricService = {
  async record(): Promise<void> {
    // no-op
  },
};

export function resolveToolMetricName(input: {
  toolName: string;
  argumentsValue: Record<string, unknown>;
}): string {
  if (input.toolName !== "invoke") {
    return input.toolName;
  }

  const subTool = input.argumentsValue.tool;
  if (typeof subTool !== "string") {
    return input.toolName;
  }

  const normalizedSubTool = subTool.trim();
  if (normalizedSubTool.length === 0) {
    return input.toolName;
  }

  return `invoke:${normalizedSubTool}`;
}

export function recordToolCallMetric(input: {
  metricService: MetricService;
  runtime: "agent" | "storyAgent";
  toolName: string;
  argumentsValue: Record<string, unknown>;
}): Promise<void> {
  return input.metricService.record({
    metricName: "agent.tool.call",
    value: 1,
    tags: {
      tool: resolveToolMetricName({
        toolName: input.toolName,
        argumentsValue: input.argumentsValue,
      }),
      runtime: input.runtime,
    },
  });
}
