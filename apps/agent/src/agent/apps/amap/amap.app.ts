import { z } from "zod";
import type { App, AppStartupContext } from "@kagami/agent-runtime";
import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import { AmapClient } from "./client/amap-client.js";
import type { RootAgentEffect } from "../../runtime/effect/root-agent-effect.js";
import type { OssClient } from "../../../acl/oss-client.js";
import { GeocodeTool } from "./tools/geocode.tool.js";
import { RegeocodeTool } from "./tools/regeocode.tool.js";
import { SearchPoiTool } from "./tools/search-poi.tool.js";
import { SearchAroundTool } from "./tools/search-around.tool.js";
import { PlanRouteTool } from "./tools/plan-route.tool.js";
import { PlanTransitTool } from "./tools/plan-transit.tool.js";
import { WeatherTool } from "./tools/weather.tool.js";
import { StaticMapTool } from "./tools/static-map.tool.js";

const AMAP_APP_ID = "amap";

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

/** 进入高德地图时的定位屏：不含子工具清单（清单归 help）；未配置 key 时给未配置提示。 */
function renderAmapPortal(configured: boolean): string {
  return renderServerStaticTemplate(
    import.meta.url,
    configured ? "prompts/amap-app-portal.hbs" : "prompts/amap-app-not-configured.hbs",
  );
}

/** help 屏：已配置时披露完整子工具清单与用法要点；未配置时与 portal 同为未配置提示。 */
function renderAmapHelp(configured: boolean): string {
  return renderServerStaticTemplate(
    import.meta.url,
    configured ? "prompts/amap-app-help.hbs" : "prompts/amap-app-not-configured.hbs",
  );
}

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
  public readonly description = "查地点与路线，搜周边、看天气、生成地图。";
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
    return renderAmapHelp(this.canInvoke());
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

  /** 进入高德地图：只给静态提示屏，不自动拉任何接口（本地模板渲染，永不失败）。 */
  public async onFocus(): Promise<readonly RootAgentEffect[]> {
    return [{ type: "append_message", content: renderAmapPortal(this.canInvoke()) }];
  }
}
