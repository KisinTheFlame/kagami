import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { renderGeocode } from "../amap-screen.js";
import type { AmapClient } from "../client/amap-client.js";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";

export const GEOCODE_TOOL_NAME = "geocode";

const Schema = z.object({
  address: z.string().min(1),
  // city 可能是 adcode/citycode，模型易当数字传——收下数字并转字符串。
  city: z
    .union([z.string().min(1), z.number()])
    .transform(v => String(v))
    .optional(),
});

type Deps = { getClient: () => AmapClient; getMaxChars: () => number };

/** 地理编码：把地名 / 结构化地址解析成坐标 + adcode + citycode（后续 weather / 路径要用）。 */
export class GeocodeTool extends ZodToolComponent<typeof Schema> {
  public readonly name = GEOCODE_TOOL_NAME;
  public readonly description =
    "地理编码：把地名或地址解析成坐标(GCJ-02)、adcode、citycode。只能在 amap App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      address: { type: "string", description: "要解析的地名 / 地址，如 '北京市朝阳区天安门'。" },
      city: {
        type: "string",
        description: "可选，限定城市（城市名 / adcode / citycode）提升命中。",
      },
    },
    required: ["address"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;

  private readonly getClient: () => AmapClient;
  private readonly getMaxChars: () => number;

  public constructor({ getClient, getMaxChars }: Deps) {
    super();
    this.getClient = getClient;
    this.getMaxChars = getMaxChars;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<ToolExecutionResult> {
    const items = await this.getClient().geocode({ address: input.address, city: input.city });
    const content = renderGeocode(input.address, items, this.getMaxChars());
    const effects: RootAgentEffect[] = [{ type: "append_message", content }];
    return { content: JSON.stringify({ ok: true, count: items.length }), effects };
  }
}
