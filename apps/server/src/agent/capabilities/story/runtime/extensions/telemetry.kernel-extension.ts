import type {
  ReActKernelExtension,
  ReActKernelRunRoundInput,
  ToolSetExecutionResult,
} from "@kagami/agent-runtime";
import type { LlmClient } from "../../../../../llm/client.js";
import type { MetricService } from "../../../../../metric/application/metric.service.js";
import { recordToolCallMetric } from "../../../../runtime/tool-call-metric.js";

type StoryCompletion = Awaited<ReturnType<LlmClient["chat"]>>;

/**
 * 把每轮工具执行后的 metric 上报挂到 kernel 上。除 metric 之外没有任何持久化或状态变更。
 */
export class StoryToolCallMetricKernelExtension implements ReActKernelExtension<
  "storyAgent",
  StoryCompletion
> {
  private readonly metricService: MetricService;

  public constructor({ metricService }: { metricService: MetricService }) {
    this.metricService = metricService;
  }

  public async onAfterToolExecution(input: {
    request: ReActKernelRunRoundInput<"storyAgent">;
    completion: StoryCompletion;
    toolCall: {
      name: string;
      arguments: Record<string, unknown>;
    };
    result: ToolSetExecutionResult;
  }): Promise<void> {
    void input.request;
    void input.completion;
    void input.result;
    void recordToolCallMetric({
      metricService: this.metricService,
      runtime: "storyAgent",
      toolName: input.toolCall.name,
      argumentsValue: input.toolCall.arguments,
    });
  }
}
