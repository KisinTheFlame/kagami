import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { browserApiContract } from "@kagami/browser-api/contract";
import type { BrowserService } from "../application/browser.service.js";
import type { SerialExecutor } from "../application/serial-executor.js";

/**
 * 浏览器动作 HTTP 端点，全量走 @kagami/browser-api 契约（单一事实源，与 agent 侧 createClient
 * 共享同一份 Zod schema —— 改契约 input/output，此处 execute 与 agent 门面同时编译报错，issue #230）。
 *
 * - 所有动作经 SerialExecutor 串行执行，保住 epoch / pageStack 不变量。
 * - 抛出的 BrowserError 由 runtime 的 setErrorHandler 统一序列化成
 *   `{ code, message, context }` 的非 2xx 响应，agent 侧 HttpBrowserClient 据此重建
 *   BrowserError——tool_result 字节因此与拆分前完全一致（KV 缓存契约，见 issue #173）。
 * - 截图：服务返 Buffer，这里转 base64 over JSON（localhost 低频，+33% 体积可接受）。
 */
export class BrowserHandler {
  private readonly service: BrowserService;
  private readonly serial: SerialExecutor;

  public constructor({ service, serial }: { service: BrowserService; serial: SerialExecutor }) {
    this.service = service;
    this.serial = serial;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, browserApiContract.navigate, async ({ input }) => {
      return await this.serial.run(() => this.service.navigate(input.url));
    });

    registerJsonRoute(app, browserApiContract.observe, async () => {
      return await this.serial.run(() => this.service.observe());
    });

    registerJsonRoute(app, browserApiContract.click, async ({ input }) => {
      return await this.serial.run(() => this.service.click(input.target));
    });

    registerJsonRoute(app, browserApiContract.type, async ({ input }) => {
      return await this.serial.run(() =>
        this.service.type(input.target, input.value, input.submit),
      );
    });

    registerJsonRoute(app, browserApiContract.press, async ({ input }) => {
      await this.serial.run(() => this.service.press(input.key));
      return {};
    });

    registerJsonRoute(app, browserApiContract.waitFor, async ({ input }) => {
      await this.serial.run(() => this.service.waitFor({ selector: input.selector, ms: input.ms }));
      return {};
    });

    registerJsonRoute(app, browserApiContract.screenshot, async () => {
      const shot = await this.serial.run(() => this.service.screenshot());
      return {
        imageBase64: shot.image.toString("base64"),
        mimeType: shot.mimeType,
        width: shot.width,
        height: shot.height,
        url: shot.url,
      };
    });

    registerJsonRoute(app, browserApiContract.eval, async ({ input }) => {
      const result = await this.serial.run(() => this.service.evaluate(input.script));
      return { result };
    });

    // 只读字段，不占动作队列。
    registerJsonRoute(app, browserApiContract.location, () => {
      return this.service.getLastLocation();
    });
  }
}
