import type { z } from "zod";
import { createClient, notReadyFallbackMapper, type JsonClient } from "@kagami/rpc-client/client";
import { browserApiContract, type TypeValueSchema } from "@kagami/browser-api/contract";
import {
  BrowserError,
  type BrowserErrorCode,
  type BrowserErrorContext,
} from "../agent/capabilities/browser/domain/errors.js";

/** observe 结果：直接取契约 output（门面 == 契约，改契约此处与工具一起编译报错）。 */
export type ObserveResult = z.infer<typeof browserApiContract.observe.output>;

type ScreenshotWire = z.infer<typeof browserApiContract.screenshot.output>;

/** 截图结果：契约 wire 形状去掉 imageBase64、换成解码后的 Buffer（wire 与门面的唯一变换点）。 */
export type ScreenshotResult = Omit<ScreenshotWire, "imageBase64"> & { image: Buffer };

type TypeValue = z.infer<typeof TypeValueSchema>;

/**
 * 浏览器客户端门面：方法签名**逐一镜像** BrowserService 公有方法，8 个工具从返回对象的具名字段
 * 重新 JSON.stringify——tool_result 字节因此与进程拆分前完全一致（KV 缓存契约，issue #173，由
 * apps/agent/test/browser/browser-client-wire.test.ts 的字节基线钉死）。
 *
 * wire 层走 @kagami/browser-api 契约驱动的 createClient（issue #230）：请求/响应形状与服务端
 * handler 共享同一份 Zod schema，改契约两端同时编译报错。门面只保留两处变换：screenshot 的
 * base64 → Buffer、eval 的 { result } 信封拆包。
 */
export interface BrowserClient {
  navigate(url: string): Promise<z.infer<typeof browserApiContract.navigate.output>>;
  observe(): Promise<ObserveResult>;
  click(target: string): Promise<z.infer<typeof browserApiContract.click.output>>;
  type(
    target: string,
    value: TypeValue,
    submit: boolean,
  ): Promise<z.infer<typeof browserApiContract.type.output>>;
  press(key: string): Promise<void>;
  waitFor(input: { selector?: string; ms?: number }): Promise<void>;
  screenshot(): Promise<ScreenshotResult>;
  evaluate(script: string): Promise<string>;
  getLocation(): Promise<z.infer<typeof browserApiContract.location.output>>;
}

type FetchLike = typeof fetch;

type HttpBrowserClientDeps = {
  baseUrl: string;
  fetch?: FetchLike;
};

type WireError = { code?: string; message?: string; context?: BrowserErrorContext };

/**
 * 把浏览器动作经 HTTP 打到独立的 kagami-browser 进程。
 *
 * - 非 2xx：响应体 `{ code, message, context }` 原样重建成 BrowserError 再抛（decodeError），交
 *   工具基类经现有 serializeBrowserError 产出同样字节。
 * - 连接拒绝 / 超时 / 无效响应：统一映射成 BrowserError("BROWSER_NOT_READY")（mapFallbackError），
 *   保证 tool_result 永远是规整的失败结构（不抛普通 Error、不挂死主循环）。
 */
export class HttpBrowserClient implements BrowserClient {
  private readonly api: JsonClient<typeof browserApiContract>;

  public constructor({ baseUrl, fetch: fetchImpl }: HttpBrowserClientDeps) {
    this.api = createClient(browserApiContract, {
      baseUrl,
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
      decodeError: (_status, body) => {
        const wire = body as WireError | null;
        if (wire && typeof wire.code === "string") {
          return new BrowserError(
            wire.code as BrowserErrorCode,
            wire.message ?? "",
            wire.context ?? {},
          );
        }
        return undefined;
      },
      mapFallbackError: notReadyFallbackMapper(
        "浏览器服务",
        message => new BrowserError("BROWSER_NOT_READY", message),
      ),
    });
  }

  public async navigate(url: string): Promise<{ url: string; title: string }> {
    return await this.api.navigate({ url });
  }

  public async observe(): Promise<ObserveResult> {
    return await this.api.observe({});
  }

  public async click(target: string): Promise<{ url: string }> {
    return await this.api.click({ target });
  }

  public async type(target: string, value: TypeValue, submit: boolean): Promise<{ url: string }> {
    return await this.api.type({ target, value, submit });
  }

  public async press(key: string): Promise<void> {
    await this.api.press({ key });
  }

  public async waitFor(input: { selector?: string; ms?: number }): Promise<void> {
    await this.api.waitFor(input);
  }

  public async screenshot(): Promise<ScreenshotResult> {
    const { imageBase64, ...rest } = await this.api.screenshot({});
    return { ...rest, image: Buffer.from(imageBase64, "base64") };
  }

  public async evaluate(script: string): Promise<string> {
    const { result } = await this.api.eval({ script });
    return result;
  }

  public async getLocation(): Promise<{ lastUrl: string | null; lastTitle: string | null }> {
    return await this.api.location({});
  }
}
