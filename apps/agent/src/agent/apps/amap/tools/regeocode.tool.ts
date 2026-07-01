import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { renderRegeocode } from "../amap-screen.js";
import type { AmapClient } from "../client/amap-client.js";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";

export const REGEOCODE_TOOL_NAME = "regeocode";

const Schema = z.object({
  location: z.string().min(1),
});

type Deps = { getClient: () => AmapClient; getMaxChars: () => number };

/** 逆地理编码：把坐标转回结构化地址 + 所在区划。 */
export class RegeocodeTool extends ZodToolComponent<typeof Schema> {
  public readonly name = REGEOCODE_TOOL_NAME;
  public readonly description =
    "逆地理编码：把坐标(GCJ-02 '经度,纬度')转回地址和所在区划。只能在 amap App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "坐标，GCJ-02 '经度,纬度'，经度在前，如 '116.397,39.909'。",
      },
    },
    required: ["location"],
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
    const result = await this.getClient().regeocode({ location: input.location });
    const content = renderRegeocode(input.location, result, this.getMaxChars());
    const effects: RootAgentEffect[] = [{ type: "append_message", content }];
    return { content: JSON.stringify({ ok: true, adcode: result.adcode ?? null }), effects };
  }
}
