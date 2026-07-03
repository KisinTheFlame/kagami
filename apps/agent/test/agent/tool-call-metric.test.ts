import { describe, expect, it, vi } from "vitest";
import type { MetricClient } from "@kagami/metric-client/client";
import {
  recordToolCallMetric,
  resolveToolMetricName,
} from "../../src/agent/runtime/tool-call-metric.js";

function createMetricClientMock(): MetricClient {
  return {
    record: vi.fn().mockResolvedValue(undefined),
  };
}

describe("tool-call-metric", () => {
  it("resolves plain tool names as-is", () => {
    expect(
      resolveToolMetricName({
        toolName: "search_web",
        argumentsValue: {},
      }),
    ).toBe("search_web");
  });

  it("resolves invoke subtools into invoke:subTool", () => {
    expect(
      resolveToolMetricName({
        toolName: "invoke",
        argumentsValue: {
          tool: "send_message",
        },
      }),
    ).toBe("invoke:send_message");
  });

  it("falls back to invoke when the subtool is missing", () => {
    expect(
      resolveToolMetricName({
        toolName: "invoke",
        argumentsValue: {},
      }),
    ).toBe("invoke");
  });

  it("records tool call metrics with runtime and normalized tool tags", async () => {
    const metricService = createMetricClientMock();

    await recordToolCallMetric({
      metricService,
      runtime: "agent",
      toolName: "invoke",
      argumentsValue: {
        tool: "send_message",
      },
    });

    expect(metricService.record).toHaveBeenCalledWith({
      metricName: "agent.tool.call",
      value: 1,
      tags: {
        tool: "invoke:send_message",
        runtime: "agent",
      },
    });
  });
});
