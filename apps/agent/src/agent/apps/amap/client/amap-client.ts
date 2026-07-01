import { z } from "zod";
import { BizError } from "@kagami/kernel/errors/biz-error";
import {
  amapFetchImage,
  amapFetchJson,
  type AmapFetchOptions,
  type AmapImage,
} from "./amap-fetch.js";
import { normalizeLngLat } from "./amap-coord.js";

/**
 * 断言 safeParse 成功，否则抛。**解析失败即抛**，不静默降级成空结果——否则高德改字段 /
 * 套餐降级 / 返回异常结构时，工具会把「解析失败」误报成「没找到 / 没规划出」（静默数据损坏）。
 * 抛出后基类会 catch 成结构化 tool_result，让 Agent 知道是接口异常而非真的空。
 *
 * 用断言函数（asserts）而非返回值：调用方持有的是具体 schema，narrow 后 `parsed.data`
 * 保持精确类型，避免泛型 helper 把返回值退化成 any。
 */
function assertParsed<T>(
  parsed: z.SafeParseReturnType<unknown, T>,
  endpoint: string,
): asserts parsed is z.SafeParseSuccess<T> {
  if (!parsed.success) {
    throw new BizError({
      message: `高德 ${endpoint} 响应结构无法解析（可能是接口变更或异常返回）`,
      meta: { reason: "AMAP_PARSE_FAILED", endpoint },
    });
  }
}

/** 高德 Web 服务 API 基址。 */
const V3 = "https://restapi.amap.com/v3";
const V5 = "https://restapi.amap.com/v5";

export type AmapDriveMode = "driving" | "walking" | "bicycling";

/**
 * 高德字段类型极不稳：同一字段可能回字符串（`"396"`）、数字（`215`），**空值还会回空数组
 * `[]`**（如 geocode 查省市级地名时 `district` / `city` 回 `[]`）。这里对任意输入一律收口：
 * string 原样、number 转字符串、其余（`[]` / `{}` / null / undefined / bool）一律归 null。
 * 绝不因个别字段类型不稳而整体解析失败（那会被 assertParsed 当成接口异常抛给用户）。
 */
const Str = z
  .unknown()
  .transform(v => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null));

// === geocode ===
const GeocodeItemSchema = z.object({
  formatted_address: Str,
  province: Str,
  city: z.unknown().transform(v => (typeof v === "string" ? v : null)),
  district: Str,
  adcode: Str,
  citycode: z.unknown().transform(v => (typeof v === "string" ? v : null)),
  location: Str,
  level: Str,
});
const GeocodeResponseSchema = z.object({ geocodes: z.array(GeocodeItemSchema).nullish() });
export type AmapGeocodeItem = z.infer<typeof GeocodeItemSchema>;

// === regeocode ===
const RegeocodeResponseSchema = z.object({
  regeocode: z
    .object({
      formatted_address: Str,
      addressComponent: z
        .object({
          province: Str,
          city: z.unknown().transform(v => (typeof v === "string" ? v : null)),
          district: Str,
          township: z.unknown().transform(v => (typeof v === "string" ? v : null)),
          adcode: Str,
        })
        .nullish(),
    })
    .nullish(),
});
export type AmapRegeocode = {
  formattedAddress: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  township: string | null;
  adcode: string | null;
};

// === POI（text / around 共用） ===
const PoiSchema = z.object({
  id: Str,
  name: Str,
  type: Str,
  address: z.unknown().transform(v => (typeof v === "string" ? v : null)),
  location: Str,
  adname: Str,
  cityname: Str,
  distance: z.unknown().transform(v => (typeof v === "string" ? v : null)),
});
const PoiResponseSchema = z.object({
  count: Str,
  pois: z.array(PoiSchema).nullish(),
});
export type AmapPoi = z.infer<typeof PoiSchema>;
export type AmapPoiResult = { count: string | null; pois: AmapPoi[] };

// === 路径规划（driving/walking/bicycling） ===
const RouteStepSchema = z.object({ instruction: Str, step_distance: Str });
const RoutePathSchema = z.object({
  distance: Str,
  // driving/walking 的耗时在 cost.duration；bicycling 不返回 cost，耗时在 path 顶层 duration。
  cost: z.object({ duration: Str }).nullish(),
  duration: Str,
  steps: z.array(RouteStepSchema).nullish(),
});
const RouteResponseSchema = z.object({
  route: z.object({ paths: z.array(RoutePathSchema).nullish() }).nullish(),
});
export type AmapRoutePath = {
  distanceMeters: string | null;
  durationSeconds: string | null;
  steps: string[];
};

// === 公交换乘 ===
const TransitSegmentSchema = z.object({
  walking: z.object({ distance: Str }).nullish(),
  bus: z
    .object({
      buslines: z
        .array(
          z.object({
            name: Str,
            departure_stop: z.object({ name: Str }).nullish(),
            arrival_stop: z.object({ name: Str }).nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
  railway: z.object({ name: Str }).nullish(),
});
const TransitSchema = z.object({
  cost: z.object({ duration: Str }).nullish(),
  distance: Str,
  walking_distance: Str,
  segments: z.array(TransitSegmentSchema).nullish(),
});
const TransitResponseSchema = z.object({
  route: z.object({ transits: z.array(TransitSchema).nullish() }).nullish(),
});
export type AmapTransitPlan = {
  durationSeconds: string | null;
  distanceMeters: string | null;
  walkingMeters: string | null;
  segments: string[];
};

// === 天气 ===
const WeatherLiveSchema = z.object({
  province: Str,
  city: Str,
  weather: Str,
  temperature: Str,
  winddirection: Str,
  windpower: Str,
  humidity: Str,
  reporttime: Str,
});
const WeatherCastSchema = z.object({
  date: Str,
  week: Str,
  dayweather: Str,
  nightweather: Str,
  daytemp: Str,
  nighttemp: Str,
  daywind: Str,
  daypower: Str,
});
const WeatherForecastSchema = z.object({
  city: Str,
  reporttime: Str,
  casts: z.array(WeatherCastSchema).nullish(),
});
const WeatherResponseSchema = z.object({
  lives: z.array(WeatherLiveSchema).nullish(),
  forecasts: z.array(WeatherForecastSchema).nullish(),
});
export type AmapWeatherLive = z.infer<typeof WeatherLiveSchema>;
export type AmapWeatherForecast = z.infer<typeof WeatherForecastSchema>;
export type AmapWeatherResult = {
  kind: "base" | "all";
  lives: AmapWeatherLive[];
  forecasts: AmapWeatherForecast[];
};

export type StaticMapMarker = {
  label?: string;
  color?: string;
  size?: "small" | "mid" | "large";
  points: string[];
};
export type StaticMapPath = { weight?: number; color?: string; points: string[] };
export type StaticMapInput = {
  location?: string;
  zoom?: number;
  size: string;
  scale: 1 | 2;
  markers?: StaticMapMarker[];
  paths?: StaticMapPath[];
};

type AmapClientDeps = {
  apiKey: string;
  fetchOptions: AmapFetchOptions;
  poiPageSize: number;
  poiPageSizeCap: number;
  aroundDefaultRadiusMeters: number;
  aroundRadiusCapMeters: number;
};

/**
 * 高德 Web 服务 API 的类型化 client：统一拼 key、走 amapFetch（含 infocode 分类重试 +
 * key 脱敏），用宽松 zod 解析回我们渲染要用的字段。坐标入口一律经 normalizeLngLat 校验。
 */
export class AmapClient {
  private readonly apiKey: string;
  private readonly fetchOptions: AmapFetchOptions;
  private readonly poiPageSize: number;
  private readonly poiPageSizeCap: number;
  private readonly aroundDefaultRadiusMeters: number;
  private readonly aroundRadiusCapMeters: number;

  public constructor(deps: AmapClientDeps) {
    this.apiKey = deps.apiKey;
    this.fetchOptions = deps.fetchOptions;
    this.poiPageSize = deps.poiPageSize;
    this.poiPageSizeCap = deps.poiPageSizeCap;
    this.aroundDefaultRadiusMeters = deps.aroundDefaultRadiusMeters;
    this.aroundRadiusCapMeters = deps.aroundRadiusCapMeters;
  }

  public async geocode(input: { address: string; city?: string }): Promise<AmapGeocodeItem[]> {
    const params = this.baseParams({ address: input.address });
    if (input.city) {
      params.set("city", input.city);
    }
    const raw = await amapFetchJson(`${V3}/geocode/geo?${params}`, this.fetchOptions);
    const parsed = GeocodeResponseSchema.safeParse(raw);
    assertParsed(parsed, "geocode");
    return parsed.data.geocodes ?? [];
  }

  public async regeocode(input: { location: string }): Promise<AmapRegeocode> {
    const params = this.baseParams({ location: normalizeLngLat(input.location) });
    const raw = await amapFetchJson(`${V3}/geocode/regeo?${params}`, this.fetchOptions);
    const parsed = RegeocodeResponseSchema.safeParse(raw);
    assertParsed(parsed, "regeocode");
    const r = parsed.data.regeocode ?? null;
    const c = r?.addressComponent ?? null;
    return {
      formattedAddress: r?.formatted_address ?? null,
      province: c?.province ?? null,
      city: c?.city ?? null,
      district: c?.district ?? null,
      township: c?.township ?? null,
      adcode: c?.adcode ?? null,
    };
  }

  public async searchPoi(input: {
    keywords?: string;
    types?: string;
    region?: string;
    cityLimit?: boolean;
    pageSize?: number;
    pageNum?: number;
  }): Promise<AmapPoiResult> {
    const params = this.baseParams({});
    if (input.keywords) {
      params.set("keywords", input.keywords);
    }
    if (input.types) {
      params.set("types", input.types);
    }
    if (input.region) {
      params.set("region", input.region);
    }
    if (input.cityLimit) {
      params.set("city_limit", "true");
    }
    params.set("page_size", String(this.clampPageSize(input.pageSize)));
    params.set("page_num", String(input.pageNum && input.pageNum > 0 ? input.pageNum : 1));
    const raw = await amapFetchJson(`${V5}/place/text?${params}`, this.fetchOptions);
    return this.parsePoi(raw);
  }

  public async searchAround(input: {
    location: string;
    keywords?: string;
    types?: string;
    radius?: number;
    pageSize?: number;
    pageNum?: number;
  }): Promise<AmapPoiResult> {
    const params = this.baseParams({ location: normalizeLngLat(input.location) });
    if (input.keywords) {
      params.set("keywords", input.keywords);
    }
    if (input.types) {
      params.set("types", input.types);
    }
    params.set("radius", String(this.clampRadius(input.radius)));
    params.set("page_size", String(this.clampPageSize(input.pageSize)));
    params.set("page_num", String(input.pageNum && input.pageNum > 0 ? input.pageNum : 1));
    const raw = await amapFetchJson(`${V5}/place/around?${params}`, this.fetchOptions);
    return this.parsePoi(raw);
  }

  public async planRoute(input: {
    origin: string;
    destination: string;
    mode: AmapDriveMode;
  }): Promise<AmapRoutePath[]> {
    const params = this.baseParams({
      origin: normalizeLngLat(input.origin, "origin"),
      destination: normalizeLngLat(input.destination, "destination"),
      // 默认响应不含耗时/分步，必须显式打开 cost(含 duration) 与 navi(含 step 指令)。
      show_fields: "cost,navi",
    });
    const raw = await amapFetchJson(`${V5}/direction/${input.mode}?${params}`, this.fetchOptions);
    const parsed = RouteResponseSchema.safeParse(raw);
    assertParsed(parsed, `direction/${input.mode}`);
    const paths = parsed.data.route?.paths ?? [];
    return paths.map(p => ({
      distanceMeters: p.distance,
      // driving/walking 在 cost.duration；bicycling 无 cost，耗时在顶层 duration。
      durationSeconds: p.cost?.duration ?? p.duration ?? null,
      steps: (p.steps ?? []).map(s => s.instruction).filter((x): x is string => Boolean(x)),
    }));
  }

  public async planTransit(input: {
    origin: string;
    destination: string;
    city1: string;
    city2: string;
  }): Promise<AmapTransitPlan[]> {
    const params = this.baseParams({
      origin: normalizeLngLat(input.origin, "origin"),
      destination: normalizeLngLat(input.destination, "destination"),
      city1: input.city1,
      city2: input.city2,
      show_fields: "cost",
    });
    const raw = await amapFetchJson(
      `${V5}/direction/transit/integrated?${params}`,
      this.fetchOptions,
    );
    const parsed = TransitResponseSchema.safeParse(raw);
    assertParsed(parsed, "direction/transit");
    const transits = parsed.data.route?.transits ?? [];
    return transits.map(t => ({
      durationSeconds: t.cost?.duration ?? null,
      distanceMeters: t.distance,
      walkingMeters: t.walking_distance,
      segments: (t.segments ?? []).map(describeSegment).filter((x): x is string => Boolean(x)),
    }));
  }

  public async weather(input: {
    adcode: string;
    kind: "base" | "all";
  }): Promise<AmapWeatherResult> {
    const params = this.baseParams({
      city: input.adcode,
      extensions: input.kind,
    });
    const raw = await amapFetchJson(`${V3}/weather/weatherInfo?${params}`, this.fetchOptions);
    const parsed = WeatherResponseSchema.safeParse(raw);
    assertParsed(parsed, "weather");
    return {
      kind: input.kind,
      lives: parsed.data.lives ?? [],
      forecasts: parsed.data.forecasts ?? [],
    };
  }

  public async staticMap(input: StaticMapInput): Promise<AmapImage> {
    const params = this.baseParams({ size: input.size, scale: String(input.scale) });
    if (input.location) {
      params.set("location", normalizeLngLat(input.location));
    }
    if (input.zoom !== undefined) {
      params.set("zoom", String(input.zoom));
    }
    const markerStr = buildMarkers(input.markers);
    if (markerStr) {
      params.set("markers", markerStr);
    }
    const pathStr = buildPaths(input.paths);
    if (pathStr) {
      params.set("paths", pathStr);
    }
    return amapFetchImage(`${V3}/staticmap?${params}`, this.fetchOptions);
  }

  private baseParams(extra: Record<string, string>): URLSearchParams {
    return new URLSearchParams({ key: this.apiKey, ...extra });
  }

  private parsePoi(raw: unknown): AmapPoiResult {
    const parsed = PoiResponseSchema.safeParse(raw);
    assertParsed(parsed, "place");
    return { count: parsed.data.count, pois: parsed.data.pois ?? [] };
  }

  private clampPageSize(pageSize?: number): number {
    const v = pageSize && pageSize > 0 ? pageSize : this.poiPageSize;
    return Math.min(v, this.poiPageSizeCap);
  }

  private clampRadius(radius?: number): number {
    const v = radius && radius > 0 ? radius : this.aroundDefaultRadiusMeters;
    return Math.min(v, this.aroundRadiusCapMeters);
  }
}

/** 把一个换乘段压成一句人话。优先公交/地铁线路名，否则标步行段。 */
function describeSegment(seg: z.infer<typeof TransitSegmentSchema>): string | null {
  const line = seg.bus?.buslines?.find(b => b.name)?.name;
  if (line) {
    return `乘 ${line}`;
  }
  if (seg.railway?.name) {
    return `乘 ${seg.railway.name}`;
  }
  if (seg.walking?.distance) {
    return `步行 ${seg.walking.distance} 米`;
  }
  return null;
}

// 高德静态地图 label 只接受单个 0-9 / A-Z（大写）。传汉字 / 小写 / 多字符会让整张图
// 报参数错误，所以入口就 uppercase 后收窄到这个集合，非法则丢弃 label（标注点仍画）。
const MARKER_LABEL_RE = /^[0-9A-Z]$/;
const COLOR_RE = /^0x[0-9a-fA-F]{6}$/;
const MARKER_MAX_POINTS = 10; // 高德静态地图标注点总数上限
const PATH_MAX_POINTS = 100; // 单条折线点数上限，防超长 URL

/** 校验高德颜色（`0xRRGGBB`）；非法回退到给定默认，避免颜色里的 : ; | , 污染线协议串。 */
function safeColor(color: string | undefined, fallback: string): string {
  return color && COLOR_RE.test(color) ? color : fallback;
}

/** 把结构化 markers 拼成高德线协议串；样式 `size,color,label:loc;loc`，标注点总数 ≤10。 */
function buildMarkers(markers?: StaticMapMarker[]): string | null {
  if (!markers || markers.length === 0) {
    return null;
  }
  const groups: string[] = [];
  let pointCount = 0;
  for (const m of markers) {
    const size = m.size ?? "mid";
    const color = safeColor(m.color, "0xFF0000");
    const upper = m.label?.toUpperCase() ?? "";
    const label = MARKER_LABEL_RE.test(upper) ? upper : "";
    const locs: string[] = [];
    for (const p of m.points) {
      if (pointCount >= MARKER_MAX_POINTS) {
        break;
      }
      locs.push(normalizeLngLat(p, "marker.points"));
      pointCount += 1;
    }
    if (locs.length > 0) {
      groups.push(`${size},${color},${label}:${locs.join(";")}`);
    }
    if (pointCount >= MARKER_MAX_POINTS) {
      break;
    }
  }
  return groups.length > 0 ? groups.join("|") : null;
}

/** 把结构化 paths 拼成高德线协议串；样式 `weight,color:loc;loc`，最多 4 条折线、每条 ≤100 点。 */
function buildPaths(paths?: StaticMapPath[]): string | null {
  if (!paths || paths.length === 0) {
    return null;
  }
  const groups: string[] = [];
  for (const p of paths.slice(0, 4)) {
    const weight = p.weight && p.weight > 0 ? p.weight : 5;
    const color = safeColor(p.color, "0x0000FF");
    const locs = p.points.slice(0, PATH_MAX_POINTS).map(pt => normalizeLngLat(pt, "path.points"));
    if (locs.length > 0) {
      groups.push(`${weight},${color}:${locs.join(";")}`);
    }
  }
  return groups.length > 0 ? groups.join("|") : null;
}
