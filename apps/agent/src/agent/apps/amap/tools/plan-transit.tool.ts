import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { renderTransit } from "../amap-screen.js";
import type { AmapClient } from "../client/amap-client.js";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";

export const PLAN_TRANSIT_TOOL_NAME = "plan_transit";

const Schema = z.object({
  origin: z.string().min(1),
  destination: z.string().min(1),
  city1: z.string().min(1),
  city2: z.string().min(1),
});

type Deps = {
  getClient: () => AmapClient;
  getMaxChars: () => number;
  getMaxPlans: () => number;
};

/** 公交换乘规划（高德 v5 transit/integrated）。city1/city2 只收 citycode（geocode 可拿）。 */
export class PlanTransitTool extends ZodToolComponent<typeof Schema> {
  public readonly name = PLAN_TRANSIT_TOOL_NAME;
  public readonly description =
    "规划公交 / 地铁换乘方案。city1（起点城市 citycode）/ city2（终点城市 citycode）必填，用 geocode 拿 citycode。只能在 amap App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      origin: { type: "string", description: "起点坐标，GCJ-02 '经度,纬度'，经度在前。" },
      destination: { type: "string", description: "终点坐标，GCJ-02 '经度,纬度'，经度在前。" },
      city1: {
        type: "string",
        description: "起点城市 citycode（不是城市名），如北京 '010'。geocode 返回里有。",
      },
      city2: { type: "string", description: "终点城市 citycode。同城出行 city1==city2。" },
    },
    required: ["origin", "destination", "city1", "city2"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;

  private readonly getClient: () => AmapClient;
  private readonly getMaxChars: () => number;
  private readonly getMaxPlans: () => number;

  public constructor({ getClient, getMaxChars, getMaxPlans }: Deps) {
    super();
    this.getClient = getClient;
    this.getMaxChars = getMaxChars;
    this.getMaxPlans = getMaxPlans;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<ToolExecutionResult> {
    const plans = await this.getClient().planTransit({
      origin: input.origin,
      destination: input.destination,
      city1: input.city1,
      city2: input.city2,
    });
    const content = renderTransit(plans, this.getMaxPlans(), this.getMaxChars());
    const effects: RootAgentEffect[] = [{ type: "append_message", content }];
    return { content: JSON.stringify({ ok: true, plans: plans.length }), effects };
  }
}
