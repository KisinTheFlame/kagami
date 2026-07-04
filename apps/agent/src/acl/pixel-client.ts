import { createClient, notReadyFallbackMapper, type JsonClient } from "@kagami/rpc-client/client";
import { createBinaryClient, type BinaryClient } from "@kagami/rpc-client/binary-client";
import { pixelApiContract, type CanvasResponse } from "@kagami/pixel-api/contract";
import { PixelError } from "../agent/capabilities/pixel/domain/errors.js";

// === 像素画客户端：把绘图动作经 HTTP 打到独立的 kagami-pixel 进程（issue #365）===
//
// 绘图 / 查看端点走契约驱动的 createClient，返回 CanvasResponse（领域拒绝是 { ok:false }，
// 不抛异常）；服务不可达 / 500 / 坏响应统一映射 PIXEL_NOT_READY。render 走 createBinaryClient
// 的 raw 路由（返回裸 Response），下面自己判 status / content-type 并把字节读成 Buffer——
// 无画布服务回 409（→ PIXEL_NO_CANVAS），其余非 2xx / 不可达 → PIXEL_NOT_READY。

export type PixelInput = { x: number; y: number; color: string };

export interface PixelClient {
  newCanvas(width: number, height: number): Promise<CanvasResponse>;
  getCanvas(): Promise<CanvasResponse>;
  setPixels(pixels: readonly PixelInput[]): Promise<CanvasResponse>;
  fill(x: number, y: number, color: string): Promise<CanvasResponse>;
  line(x1: number, y1: number, x2: number, y2: number, color: string): Promise<CanvasResponse>;
  rect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    filled: boolean,
  ): Promise<CanvasResponse>;
  circle(
    cx: number,
    cy: number,
    radius: number,
    color: string,
    filled: boolean,
  ): Promise<CanvasResponse>;
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    color: string,
    filled: boolean,
  ): Promise<CanvasResponse>;
  clear(): Promise<CanvasResponse>;
  /** 渲染当前画布为 PNG 字节。无画布 → PIXEL_NO_CANVAS；不可达 → PIXEL_NOT_READY。 */
  render(): Promise<Buffer>;
}

type FetchLike = typeof fetch;

// createClient 只吃 JSON 路由；render 是 binary-raw，单独交给 createBinaryClient。
const jsonContract = {
  newCanvas: pixelApiContract.newCanvas,
  getCanvas: pixelApiContract.getCanvas,
  setPixels: pixelApiContract.setPixels,
  fill: pixelApiContract.fill,
  line: pixelApiContract.line,
  rect: pixelApiContract.rect,
  circle: pixelApiContract.circle,
  ellipse: pixelApiContract.ellipse,
  clear: pixelApiContract.clear,
};

export class HttpPixelClient implements PixelClient {
  private readonly api: JsonClient<typeof jsonContract>;
  private readonly binary: BinaryClient<{ render: typeof pixelApiContract.render }>;

  public constructor({ baseUrl, fetch: fetchImpl }: { baseUrl: string; fetch?: FetchLike }) {
    const fetchOption = fetchImpl === undefined ? {} : { fetch: fetchImpl };
    this.api = createClient(jsonContract, {
      baseUrl,
      ...fetchOption,
      // 领域拒绝走 200 的 { ok:false }；非 2xx 一律不可达/故障 → PIXEL_NOT_READY。
      decodeError: () => undefined,
      mapFallbackError: notReadyFallbackMapper(
        "像素画服务",
        message => new PixelError("PIXEL_NOT_READY", message),
      ),
    });
    this.binary = createBinaryClient(
      { render: pixelApiContract.render },
      { baseUrl, ...fetchOption },
    );
  }

  public newCanvas(width: number, height: number): Promise<CanvasResponse> {
    return this.api.newCanvas({ width, height });
  }

  public getCanvas(): Promise<CanvasResponse> {
    return this.api.getCanvas({});
  }

  public setPixels(pixels: readonly PixelInput[]): Promise<CanvasResponse> {
    return this.api.setPixels({ pixels: [...pixels] });
  }

  public fill(x: number, y: number, color: string): Promise<CanvasResponse> {
    return this.api.fill({ x, y, color });
  }

  public line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
  ): Promise<CanvasResponse> {
    return this.api.line({ x1, y1, x2, y2, color });
  }

  public rect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    filled: boolean,
  ): Promise<CanvasResponse> {
    return this.api.rect({ x1, y1, x2, y2, color, filled });
  }

  public circle(
    cx: number,
    cy: number,
    radius: number,
    color: string,
    filled: boolean,
  ): Promise<CanvasResponse> {
    return this.api.circle({ cx, cy, radius, color, filled });
  }

  public ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    color: string,
    filled: boolean,
  ): Promise<CanvasResponse> {
    return this.api.ellipse({ cx, cy, rx, ry, color, filled });
  }

  public clear(): Promise<CanvasResponse> {
    return this.api.clear({});
  }

  public async render(): Promise<Buffer> {
    let response: Response;
    try {
      response = await this.binary.render({ params: {} });
    } catch (cause) {
      throw new PixelError(
        "PIXEL_NOT_READY",
        `像素画服务不可达（未启动 / 半开 / 超时）：${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
    if (response.status === 409) {
      const body = (await response.json().catch(() => null)) as { reason?: string } | null;
      throw new PixelError("PIXEL_NO_CANVAS", body?.reason ?? "还没有画布，先用 new_canvas 起手。");
    }
    if (!response.ok) {
      throw new PixelError("PIXEL_NOT_READY", `像素画服务返回 HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/png")) {
      throw new PixelError("PIXEL_NOT_READY", `像素画服务返回了非 PNG 响应（${contentType}）`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}
