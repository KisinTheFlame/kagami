import { z } from "zod";
import type { App, AppStartupContext } from "@kagami/agent-runtime";
import { AmapClient } from "./client/amap-client.js";
import type { RootAgentEffect } from "../../runtime/effect/root-agent-effect.js";
import type { OssClient } from "../../../oss/oss-client.js";
import { GeocodeTool } from "./tools/geocode.tool.js";
import { RegeocodeTool } from "./tools/regeocode.tool.js";
import { SearchPoiTool } from "./tools/search-poi.tool.js";
import { SearchAroundTool } from "./tools/search-around.tool.js";
import { PlanRouteTool } from "./tools/plan-route.tool.js";
import { PlanTransitTool } from "./tools/plan-transit.tool.js";
import { WeatherTool } from "./tools/weather.tool.js";
import { StaticMapTool } from "./tools/static-map.tool.js";

export const AMAP_APP_ID = "amap";

const PositiveInt = z.number().int().positive();

/**
 * AmapApp 配置 schema。`apiKey` 默认空串 → 无 key 时优雅降级（canInvoke 全 false，
 * App 仍可 switch 进入，工具不可调），仿 OSS 整段省略即禁用。其余字段全带默认值，
 * 由 AppManager.startupAll 按 `server.apps.amap` 切片解析——不经 config.loader。
 */
const AmapConfigSchema = z
  .object({
    apiKey: z.string().default(""),
    fetchTimeoutMs: PositiveInt.default(10_000),
    fetchMaxAttempts: PositiveInt.default(3),
    fetchBackoffBaseMs: PositiveInt.default(500),
    fetchBackoffMaxMs: PositiveInt.default(8_000),
    poiPageSize: PositiveInt.default(10),
    poiPageSizeCap: PositiveInt.default(25),
    aroundDefaultRadiusMeters: PositiveInt.default(1_000),
    aroundRadiusCapMeters: PositiveInt.default(50_000),
    routeMaxSteps: PositiveInt.default(30),
    transitMaxPlans: PositiveInt.default(3),
    responseMaxChars: PositiveInt.default(8_000),
    staticMapDefaultSize: z
      .string()
      .regex(/^\d{1,4}\*\d{1,4}$/)
      .default("600*400"),
    staticMapScale: z.union([z.literal(1), z.literal(2)]).default(2),
  })
  .default({});

type AmapConfig = z.infer<typeof AmapConfigSchema>;

const AMAP_AFFORDANCE = [
  "<amap_portal>",
  "你进了高德地图。这里是你查地点、问路、看天气、看地图的地方。",
  "可调用工具：",
  "  - geocode(address, city?)：地名 → 坐标 + adcode + citycode（查天气 / 规划路线前先用它拿坐标）。",
  "  - regeocode(location)：坐标 → 地址。",
  "  - search_poi(keywords|types, region?)：按关键字 / 类型搜地点。",
  "  - search_around(location, keywords?)：搜某坐标周边（先 geocode 拿坐标）。",
  "  - plan_route(origin, destination, mode)：驾车 / 步行 / 骑行路线。",
  "  - plan_transit(origin, destination, city1, city2)：公交换乘（city 用 citycode）。",
  "  - weather(adcode, kind?)：天气实况 / 预报（adcode 从 geocode 拿）。",
  "  - static_map(location?, markers?, paths?)：生成地图图片，原图直接进你的上下文。",
  "坐标一律 GCJ-02 '经度,纬度'（经度在前）。要去别的 App，用 switch(id=...) 切过去。",
  "</amap_portal>",
].join("\n");

const AMAP_NOT_CONFIGURED = [
  "<amap_portal>",
  "你进了高德地图，但它还没配置 key，暂时不能用。",
  "（让创造者在 config.yaml 的 server.apps.amap.apiKey 填上高德 Web 服务 key。）",
  "要去别的 App，用 switch(id=...) 切过去。",
  "</amap_portal>",
].join("\n");

/**
 * 高德地图 App。把高德 Web 服务 API 包成桌面上的一个能力单元，8 个 InvokeTool 子工具。
 *
 * - 工具：geocode / regeocode / search_poi / search_around / plan_route / plan_transit /
 *   weather / static_map（全是 InvokeTool 子工具，顶层 tools 列表零新增）。
 * - 自管 AmapClient：onStartup 按 config 实例化，工具通过闭包从 App 拿。
 * - key 缺省优雅降级：canInvoke 返回 apiKey 是否非空；无 key 时 App 仍注册、仍可 switch 进入，
 *   help/onFocus 明示不可用，工具不可调（仿 OSS 整段省略即禁用）。
 * - onFocus 不做任何网络 I/O：只返回静态提示屏，永不因 API 失败而进不去。
 *
 * 设计依据见仓库根 CLAUDE.md，以及 issue #182（/spec + /codex 评审）。
 */
export class AmapApp implements App<AmapConfig> {
  public readonly id = AMAP_APP_ID;
  public readonly displayName = "高德地图";
  public readonly configSchema = AmapConfigSchema;
  public readonly tools: readonly [
    GeocodeTool,
    RegeocodeTool,
    SearchPoiTool,
    SearchAroundTool,
    PlanRouteTool,
    PlanTransitTool,
    WeatherTool,
    StaticMapTool,
  ];

  private config: AmapConfig = AmapConfigSchema.parse({});
  private client: AmapClient | null = null;

  public constructor({ ossClient }: { ossClient?: OssClient } = {}) {
    const getClient = (): AmapClient => {
      if (!this.client) {
        throw new Error("AmapApp 未配置 key 或尚未完成 onStartup，AmapClient 未就绪");
      }
      return this.client;
    };
    const getMaxChars = (): number => this.config.responseMaxChars;
    this.tools = [
      new GeocodeTool({ getClient, getMaxChars }),
      new RegeocodeTool({ getClient, getMaxChars }),
      new SearchPoiTool({ getClient, getMaxChars }),
      new SearchAroundTool({ getClient, getMaxChars }),
      new PlanRouteTool({ getClient, getMaxChars, getMaxSteps: () => this.config.routeMaxSteps }),
      new PlanTransitTool({
        getClient,
        getMaxChars,
        getMaxPlans: () => this.config.transitMaxPlans,
      }),
      new WeatherTool({ getClient, getMaxChars }),
      new StaticMapTool({
        getClient,
        getDefaultSize: () => this.config.staticMapDefaultSize,
        getScale: () => this.config.staticMapScale,
        ossClient,
      }),
    ];
  }

  /** key 缺省时全工具不可调（优雅降级），App 仍可 switch 进入。 */
  public canInvoke(): boolean {
    return this.config.apiKey.length > 0;
  }

  public async help(): Promise<string> {
    if (!this.canInvoke()) {
      return AMAP_NOT_CONFIGURED;
    }
    return AMAP_AFFORDANCE;
  }

  public async onStartup(ctx: AppStartupContext<AmapConfig>): Promise<void> {
    this.config = ctx.config;
    if (ctx.config.apiKey.length === 0) {
      this.client = null;
      return;
    }
    this.client = new AmapClient({
      apiKey: ctx.config.apiKey,
      fetchOptions: {
        timeoutMs: ctx.config.fetchTimeoutMs,
        maxAttempts: ctx.config.fetchMaxAttempts,
        backoffBaseMs: ctx.config.fetchBackoffBaseMs,
        backoffMaxMs: ctx.config.fetchBackoffMaxMs,
      },
      poiPageSize: ctx.config.poiPageSize,
      poiPageSizeCap: ctx.config.poiPageSizeCap,
      aroundDefaultRadiusMeters: ctx.config.aroundDefaultRadiusMeters,
      aroundRadiusCapMeters: ctx.config.aroundRadiusCapMeters,
    });
  }

  /** 进入高德地图：只给静态提示屏，不自动拉任何接口（无网络 I/O，永不失败）。 */
  public async onFocus(): Promise<readonly RootAgentEffect[]> {
    const content = this.canInvoke() ? AMAP_AFFORDANCE : AMAP_NOT_CONFIGURED;
    return [{ type: "append_message", content }];
  }
}
