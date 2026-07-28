import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { observatoryApiContract } from "@kagami/observatory-api/contract";
import type { AlertService } from "../application/alert.service.js";

/**
 * 告警上报路由。只有一条：`POST /observatory/alert`。
 *
 * 状态码语义（明确区分「调用方错了」和「投递失败了」）：入参不合契约 → 400（走
 * createServiceApp 的默认 ZodError 出口）；其余一律 200，结局由 body 的 delivered /
 * suppressed 两个布尔表达。service 永不外抛，所以这里没有 try/catch。
 */
export class AlertHandler {
  private readonly service: AlertService;

  public constructor({ service }: { service: AlertService }) {
    this.service = service;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, observatoryApiContract.raiseAlert, ({ input }) =>
      this.service.raise(input),
    );
  }
}
