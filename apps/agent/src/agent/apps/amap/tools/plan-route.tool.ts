import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { renderRoute } from "../amap-screen.js";
import type { AmapClient } from "../client/amap-client.js";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";

const PLAN_ROUTE_TOOL_NAME = "plan_route";

const Schema = z.object({
  origin: z.string().min(1),
  destination: z.string().min(1),
  mode: z.enum(["driving", "walking", "bicycling"]),
});

type Deps = {
  getClient: () => AmapClient;
  getMaxChars: () => number;
  getMaxSteps: () => number;
};

/** 路径规划（驾车 / 步行 / 骑行）。公交走单独的 plan_transit。 */
export class PlanRouteTool extends ZodToolComponent<typeof Schema> {
  public readonly name = PLAN_ROUTE_TOOL_NAME;
  public readonly description =
    "规划两点间路线（驾车 / 步行 / 骑行），返回距离、耗时、分步导航。公交请用 plan_transit。只能在 amap App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      origin: { type: "string", description: "起点坐标，GCJ-02 '经度,纬度'，经度在前。" },
      destination: { type: "string", description: "终点坐标，GCJ-02 '经度,纬度'，经度在前。" },
      mode: {
        type: "string",
        enum: ["driving", "walking", "bicycling"],
        description: "出行方式：driving 驾车 / walking 步行 / bicycling 骑行。",
      },
    },
    required: ["origin", "destination", "mode"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;

  private readonly getClient: () => AmapClient;
  private readonly getMaxChars: () => number;
  private readonly getMaxSteps: () => number;

  public constructor({ getClient, getMaxChars, getMaxSteps }: Deps) {
    super();
    this.getClient = getClient;
    this.getMaxChars = getMaxChars;
    this.getMaxSteps = getMaxSteps;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<ToolExecutionResult> {
    const paths = await this.getClient().planRoute({
      origin: input.origin,
      destination: input.destination,
      mode: input.mode,
    });
    const content = renderRoute(input.mode, paths, this.getMaxSteps(), this.getMaxChars());
    const effects: RootAgentEffect[] = [{ type: "append_message", content }];
    return { content: JSON.stringify({ ok: true, paths: paths.length }), effects };
  }
}
