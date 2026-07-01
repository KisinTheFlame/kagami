import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { renderWeather } from "../amap-screen.js";
import type { AmapClient } from "../client/amap-client.js";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";

export const WEATHER_TOOL_NAME = "weather";

const Schema = z.object({
  adcode: z.string().min(1),
  kind: z.enum(["base", "all"]).optional(),
});

type Deps = { getClient: () => AmapClient; getMaxChars: () => number };

/** 天气查询（高德 v3 weatherInfo）。adcode 不知道就先 geocode 拿。 */
export class WeatherTool extends ZodToolComponent<typeof Schema> {
  public readonly name = WEATHER_TOOL_NAME;
  public readonly description =
    "查天气。adcode 是行政区编码（geocode 返回里有）。kind=base 实况 / all 4 天预报。只能在 amap App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      adcode: {
        type: "string",
        description: "行政区编码 adcode，如北京 '110000'。geocode 返回里有。",
      },
      kind: {
        type: "string",
        enum: ["base", "all"],
        description: "base 实况（默认）/ all 4 天预报。",
      },
    },
    required: ["adcode"],
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
    const kind = input.kind ?? "base";
    const result = await this.getClient().weather({ adcode: input.adcode, kind });
    const content = renderWeather(input.adcode, result, this.getMaxChars());
    const effects: RootAgentEffect[] = [{ type: "append_message", content }];
    return { content: JSON.stringify({ ok: true, kind }), effects };
  }
}
