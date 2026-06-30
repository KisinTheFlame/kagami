import {
  BrowserError,
  type BrowserErrorCode,
  type BrowserErrorContext,
} from "../agent/capabilities/browser/domain/errors.js";

/** observe 结果：与浏览器进程 BrowserService.observe 同构。 */
export type ObserveResult = {
  epoch: number;
  url: string;
  title: string;
  snapshot: string;
};

/** 截图结果：与浏览器进程 BrowserService.screenshot 同构（image 已从 base64 还原为 Buffer）。 */
export type ScreenshotResult = {
  image: Buffer;
  mimeType: string;
  width: number;
  height: number;
  url: string;
};

type TypeValue = { text: string } | { secret: { handle: string; field: "username" | "secret" } };

/**
 * 浏览器客户端：方法签名**逐一镜像** BrowserService 公有方法，让 8 个工具拆分后只把
 * `getBrowserService()` 换成 `getBrowserClient()`、入参/结果格式化逻辑一字不动——
 * tool_result 字节因此与拆分前完全一致（KV 缓存契约，issue #173）。
 */
export interface BrowserClient {
  navigate(url: string): Promise<{ url: string; title: string }>;
  observe(): Promise<ObserveResult>;
  click(target: string): Promise<{ url: string }>;
  type(target: string, value: TypeValue, submit: boolean): Promise<{ url: string }>;
  press(key: string): Promise<void>;
  waitFor(input: { selector?: string; ms?: number }): Promise<void>;
  screenshot(): Promise<ScreenshotResult>;
  evaluate(script: string): Promise<string>;
  getLocation(): Promise<{ lastUrl: string | null; lastTitle: string | null }>;
}

type FetchLike = typeof fetch;

type HttpBrowserClientDeps = {
  baseUrl: string;
  fetch?: FetchLike;
};

// —— 客户端超时（代码常量，不进 config）——
// 比浏览器进程内部的 NAVIGATION_TIMEOUT_MS(30s) / ACTION_TIMEOUT_MS(10s) 各留出裕量，
// 让服务端自己的超时先触发、回出规整的 BrowserError；只有进程真挂/半开时客户端才中止。
const NAVIGATION_CLIENT_TIMEOUT_MS = 40_000;
const ACTION_CLIENT_TIMEOUT_MS = 20_000;

type WireError = { code?: string; message?: string; context?: BrowserErrorContext };

/**
 * 把浏览器动作经 HTTP 打到独立的 kagami-browser 进程。
 *
 * - 非 2xx：响应体 `{ code, message, context }` 原样重建成 BrowserError 再抛，交工具基类
 *   经现有 serializeBrowserError 产出同样字节。
 * - 连接拒绝 / 超时 / 无效响应：统一映射成 BrowserError("BROWSER_NOT_READY")，保证
 *   tool_result 永远是规整的失败结构（不抛普通 Error、不挂死主循环）。
 */
export class HttpBrowserClient implements BrowserClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  public constructor({ baseUrl, fetch: fetchImpl }: HttpBrowserClientDeps) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl ?? fetch;
  }

  public async navigate(url: string): Promise<{ url: string; title: string }> {
    return (await this.post("/navigate", { url }, NAVIGATION_CLIENT_TIMEOUT_MS)) as {
      url: string;
      title: string;
    };
  }

  public async observe(): Promise<ObserveResult> {
    return (await this.post("/observe", {}, ACTION_CLIENT_TIMEOUT_MS)) as ObserveResult;
  }

  public async click(target: string): Promise<{ url: string }> {
    return (await this.post("/click", { target }, ACTION_CLIENT_TIMEOUT_MS)) as { url: string };
  }

  public async type(target: string, value: TypeValue, submit: boolean): Promise<{ url: string }> {
    return (await this.post("/type", { target, value, submit }, ACTION_CLIENT_TIMEOUT_MS)) as {
      url: string;
    };
  }

  public async press(key: string): Promise<void> {
    await this.post("/press", { key }, ACTION_CLIENT_TIMEOUT_MS);
  }

  public async waitFor(input: { selector?: string; ms?: number }): Promise<void> {
    await this.post("/wait-for", input, ACTION_CLIENT_TIMEOUT_MS);
  }

  public async screenshot(): Promise<ScreenshotResult> {
    const raw = (await this.post("/screenshot", {}, ACTION_CLIENT_TIMEOUT_MS)) as {
      imageBase64: string;
      mimeType: string;
      width: number;
      height: number;
      url: string;
    };
    return {
      image: Buffer.from(raw.imageBase64, "base64"),
      mimeType: raw.mimeType,
      width: raw.width,
      height: raw.height,
      url: raw.url,
    };
  }

  public async evaluate(script: string): Promise<string> {
    const raw = (await this.post("/eval", { script }, ACTION_CLIENT_TIMEOUT_MS)) as {
      result: string;
    };
    return raw.result;
  }

  public async getLocation(): Promise<{ lastUrl: string | null; lastTitle: string | null }> {
    return (await this.get("/location", ACTION_CLIENT_TIMEOUT_MS)) as {
      lastUrl: string | null;
      lastTitle: string | null;
    };
  }

  private async post(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
    return this.request(path, timeoutMs, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async get(path: string, timeoutMs: number): Promise<unknown> {
    return this.request(path, timeoutMs, { method: "GET" });
  }

  private async request(path: string, timeoutMs: number, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new BrowserError(
        "BROWSER_NOT_READY",
        `浏览器服务不可达（未启动 / 半开 / 超时）：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      const wire = (await response.json().catch(() => null)) as WireError | null;
      if (wire && typeof wire.code === "string") {
        throw new BrowserError(
          wire.code as BrowserErrorCode,
          wire.message ?? "",
          wire.context ?? {},
        );
      }
      throw new BrowserError("BROWSER_NOT_READY", `浏览器服务返回 HTTP ${response.status}`);
    }

    // 2xx 但 body 半截/非 JSON（进程半开、被代理截断）：归一成 BROWSER_NOT_READY，
    // 而不是让 SyntaxError 漏成 BROWSER_ERROR（兑现"不可达统一映射"承诺）。
    try {
      return await response.json();
    } catch {
      throw new BrowserError("BROWSER_NOT_READY", "浏览器服务返回了无法解析的响应体");
    }
  }
}
