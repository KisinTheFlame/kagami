import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { escapeAttr, renderPoiList } from "../amap-screen.js";
import type { AmapClient } from "../client/amap-client.js";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";

const SEARCH_AROUND_TOOL_NAME = "search_around";

const Schema = z.object({
  location: z.string().min(1),
  keywords: z.string().optional(),
  types: z.string().optional(),
  radius: z.number().int().positive().optional(),
  page_size: z.number().int().positive().optional(),
  page_num: z.number().int().positive().optional(),
});

type Deps = { getClient: () => AmapClient; getMaxChars: () => number };

/** POI 周边搜索（高德 v5 place/around）。先用 geocode 拿中心坐标再调本工具。 */
export class SearchAroundTool extends ZodToolComponent<typeof Schema> {
  public readonly name = SEARCH_AROUND_TOOL_NAME;
  public readonly description =
    "搜某个坐标周边的地点（带距离）。location 必填，先用 geocode 拿坐标。只能在 amap App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      location: { type: "string", description: "中心坐标，GCJ-02 '经度,纬度'，经度在前。" },
      keywords: { type: "string", description: "可选关键字，如 '咖啡'。" },
      types: { type: "string", description: "可选 POI 类型码 / 类型名，多个用 '|' 分隔。" },
      radius: {
        type: "number",
        description: "搜索半径(米)，0-50000，省略用 App 默认（非高德 API 默认 5000）。",
      },
      page_size: { type: "number", description: "每页条数（1-25，默认按配置）。" },
      page_num: { type: "number", description: "第几页（默认 1）。" },
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
    const result = await this.getClient().searchAround({
      location: input.location,
      keywords: input.keywords,
      types: input.types,
      radius: input.radius,
      pageSize: input.page_size,
      pageNum: input.page_num,
    });
    const attrs = ` location="${escapeAttr(input.location)}"`;
    const content = renderPoiList("amap_around", result, attrs, this.getMaxChars());
    const effects: RootAgentEffect[] = [{ type: "append_message", content }];
    return { content: JSON.stringify({ ok: true, count: result.pois.length }), effects };
  }
}
