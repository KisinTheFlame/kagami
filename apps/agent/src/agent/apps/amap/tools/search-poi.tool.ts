import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { escapeAttr, renderPoiList } from "../amap-screen.js";
import type { AmapClient } from "../client/amap-client.js";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";

export const SEARCH_POI_TOOL_NAME = "search_poi";

const Schema = z
  .object({
    keywords: z.string().max(80).optional(),
    types: z.string().optional(),
    region: z.string().optional(),
    city_limit: z.boolean().optional(),
    page_size: z.number().int().positive().optional(),
    page_num: z.number().int().positive().optional(),
  })
  .refine(v => Boolean(v.keywords) || Boolean(v.types), {
    message: "keywords 与 types 至少要给一个",
  });

type Deps = { getClient: () => AmapClient; getMaxChars: () => number };

/** POI 关键字搜索（高德 v5 place/text）。keywords 或 types 二选一必填。 */
export class SearchPoiTool extends ZodToolComponent<typeof Schema> {
  public readonly name = SEARCH_POI_TOOL_NAME;
  public readonly description =
    "按关键字 / 类型搜地点（POI）。keywords 与 types 至少给一个；region 限定城市召回。只能在 amap App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      keywords: {
        type: "string",
        description: "单个关键字，≤80 字，如 '肯德基'。与 types 至少给一个。",
      },
      types: {
        type: "string",
        description: "POI 类型码 / 类型名，多个用 '|' 分隔。与 keywords 至少给一个。",
      },
      region: {
        type: "string",
        description: "限定城市（城市名 / adcode / citycode），仅作召回权重。",
      },
      city_limit: {
        type: "boolean",
        description: "true 时严格只返回 region 城市内结果（默认 false）。",
      },
      page_size: { type: "number", description: "每页条数（1-25，默认按配置；超上限自动收口）。" },
      page_num: { type: "number", description: "第几页（默认 1）。" },
    },
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
    const result = await this.getClient().searchPoi({
      keywords: input.keywords,
      types: input.types,
      region: input.region,
      cityLimit: input.city_limit,
      pageSize: input.page_size,
      pageNum: input.page_num,
    });
    const attrs = input.keywords ? ` keywords="${escapeAttr(input.keywords)}"` : "";
    const content = renderPoiList("amap_poi", result, attrs, this.getMaxChars());
    const effects: RootAgentEffect[] = [{ type: "append_message", content }];
    return { content: JSON.stringify({ ok: true, count: result.pois.length }), effects };
  }
}
