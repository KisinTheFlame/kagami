import type { FastifyInstance } from "fastify";
import { registerBinaryRawRoute, registerJsonRoute } from "@kagami/http/register";
import {
  pixelApiContract,
  type CanvasResponse,
  type CanvasState,
} from "@kagami/pixel-api/contract";
import type { PixelService } from "../application/pixel.service.js";
import { CanvasRejectError } from "../domain/errors.js";

// === 像素画 HTTP 路由 ===
//
// 绘图 / 查看端点走 @kagami/pixel-api 契约的 registerJsonRoute，回 CanvasResponse（领域拒绝
// 以 { ok:false, reason } 带回当前画布，200）。render 是 binary-raw：手写 image/png header 回原始
// PNG 字节；无画布回 409 + JSON reason。绝不调 useRawBodyPassthrough（绘图上行是 JSON）。

export class PixelHandler {
  private readonly service: PixelService;

  public constructor({ service }: { service: PixelService }) {
    this.service = service;
  }

  /** 把一次算子包成 CanvasResponse：成功 → {ok,canvas}；领域拒绝 → {ok:false,reason,当前画布}。 */
  private async run(op: () => Promise<CanvasState>): Promise<CanvasResponse> {
    try {
      const canvas = await op();
      return { ok: true, canvas };
    } catch (error) {
      if (error instanceof CanvasRejectError) {
        return { ok: false, reason: error.message, canvas: this.service.currentState() };
      }
      throw error;
    }
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, pixelApiContract.newCanvas, ({ input }) =>
      this.run(() => this.service.newCanvas(input.width, input.height)),
    );

    registerJsonRoute(app, pixelApiContract.getCanvas, () => {
      const canvas = this.service.currentState();
      return canvas
        ? { ok: true as const, canvas }
        : { ok: false as const, reason: "还没有画布，先用 new_canvas 起手。", canvas: null };
    });

    registerJsonRoute(app, pixelApiContract.setPixels, ({ input }) =>
      this.run(() => this.service.setPixels(input.pixels)),
    );

    registerJsonRoute(app, pixelApiContract.fill, ({ input }) =>
      this.run(() => this.service.fill(input.x, input.y, input.color)),
    );

    registerJsonRoute(app, pixelApiContract.line, ({ input }) =>
      this.run(() => this.service.line(input.x1, input.y1, input.x2, input.y2, input.color)),
    );

    registerJsonRoute(app, pixelApiContract.rect, ({ input }) =>
      this.run(() =>
        this.service.rect(
          input.x1,
          input.y1,
          input.x2,
          input.y2,
          input.color,
          input.filled ?? false,
        ),
      ),
    );

    registerJsonRoute(app, pixelApiContract.circle, ({ input }) =>
      this.run(() =>
        this.service.circle(input.cx, input.cy, input.radius, input.color, input.filled ?? false),
      ),
    );

    registerJsonRoute(app, pixelApiContract.ellipse, ({ input }) =>
      this.run(() =>
        this.service.ellipse(
          input.cx,
          input.cy,
          input.rx,
          input.ry,
          input.color,
          input.filled ?? false,
        ),
      ),
    );

    registerJsonRoute(app, pixelApiContract.clear, () => this.run(() => this.service.clear()));

    registerBinaryRawRoute(app, pixelApiContract.render, async ({ raw }) => {
      let png: Buffer;
      try {
        png = this.service.renderPng();
      } catch (error) {
        if (error instanceof CanvasRejectError) {
          const body = JSON.stringify({ reason: error.message });
          raw.writeHead(409, { "content-type": "application/json" });
          raw.end(body);
          return;
        }
        throw error; // 交给 registerBinaryRawRoute 的 catch-all（500）。
      }
      raw.writeHead(200, {
        "content-type": "image/png",
        "content-length": String(png.length),
        "x-content-type-options": "nosniff",
      });
      raw.end(png);
    });
  }
}
