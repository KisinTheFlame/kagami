import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BrowserService } from "../application/browser.service.js";
import type { SerialExecutor } from "../application/serial-executor.js";

const NavigateBody = z.object({ url: z.string().min(1) });
const ClickBody = z.object({ target: z.string().min(1) });
const TypeBody = z.object({
  target: z.string().min(1),
  value: z.union([
    z.object({ text: z.string() }),
    z.object({
      secret: z.object({ handle: z.string().min(1), field: z.enum(["username", "secret"]) }),
    }),
  ]),
  submit: z.boolean(),
});
const PressBody = z.object({ key: z.string().min(1) });
const WaitForBody = z.object({
  selector: z.string().optional(),
  ms: z.number().int().positive().optional(),
});
const EvalBody = z.object({ script: z.string().min(1) });

/**
 * 浏览器动作 HTTP 端点。每个端点把请求映射到 BrowserService 的同名方法，结果以 JSON 回。
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
    app.post("/navigate", async request => {
      const body = NavigateBody.parse(request.body);
      return await this.serial.run(() => this.service.navigate(body.url));
    });

    app.post("/observe", async () => {
      return await this.serial.run(() => this.service.observe());
    });

    app.post("/click", async request => {
      const body = ClickBody.parse(request.body);
      return await this.serial.run(() => this.service.click(body.target));
    });

    app.post("/type", async request => {
      const body = TypeBody.parse(request.body);
      return await this.serial.run(() => this.service.type(body.target, body.value, body.submit));
    });

    app.post("/press", async request => {
      const body = PressBody.parse(request.body);
      await this.serial.run(() => this.service.press(body.key));
      return {};
    });

    app.post("/wait-for", async request => {
      const body = WaitForBody.parse(request.body);
      await this.serial.run(() => this.service.waitFor({ selector: body.selector, ms: body.ms }));
      return {};
    });

    app.post("/screenshot", async () => {
      const shot = await this.serial.run(() => this.service.screenshot());
      return {
        imageBase64: shot.image.toString("base64"),
        mimeType: shot.mimeType,
        width: shot.width,
        height: shot.height,
        url: shot.url,
      };
    });

    app.post("/eval", async request => {
      const body = EvalBody.parse(request.body);
      const result = await this.serial.run(() => this.service.evaluate(body.script));
      return { result };
    });

    app.get("/location", () => {
      // 只读字段，不占动作队列。
      return this.service.getLastLocation();
    });
  }
}
