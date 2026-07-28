import type { FastifyInstance } from "fastify";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { createServiceApp } from "@kagami/kernel/http/service-app";
import { HealthHandler } from "@kagami/kernel/http/health.handler";
import { HttpMetricClient } from "@kagami/metric-client/client";
import { AlertService } from "../application/alert.service.js";
import { AlertThrottle } from "../application/alert-throttle.js";
import { NapcatAlertChannel } from "../infra/napcat-alert-channel.js";
import { AlertHandler } from "../http/alert.handler.js";
import { loadObservatoryServiceConfig } from "./config.js";

const logger = new AppLogger({ source: "observatory-service-bootstrap" });

export type ObservatoryServiceRuntime = {
  app: FastifyInstance;
  port: number;
};

/**
 * kagami-observatory 进程运行时装配（issue #602）。
 *
 * 告警能力：任何服务经 `POST /observatory/alert` 上报，observatory 渲染 → 按 (source, event)
 * 去重限流 → 投递到 QQ 告警群。**零 DB**（去重窗口纯内存，重启清零：最坏是重启后多发一条
 * 重复告警）、只绑 127.0.0.1、不过 gateway。
 *
 * 用 createServiceApp 默认错误处理器：service 永不外抛，所以只有 ZodError → 400 会走到那里。
 */
export async function buildObservatoryServiceRuntime(): Promise<ObservatoryServiceRuntime> {
  const { port, alertGroupId, napcatBaseUrl, metricBaseUrl } = await loadObservatoryServiceConfig();

  const channel = new NapcatAlertChannel({ baseUrl: napcatBaseUrl, groupId: alertGroupId });
  const service = new AlertService({
    channel,
    throttle: new AlertThrottle(),
    metricService: new HttpMetricClient({ baseUrl: metricBaseUrl }),
  });

  const app = createServiceApp({
    logger,
    handlers: [new HealthHandler(), new AlertHandler({ service })],
  });

  return { app, port };
}
