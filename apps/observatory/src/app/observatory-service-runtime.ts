import type { FastifyInstance } from "fastify";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { addLoggerSink } from "@kagami/kernel/logger/runtime";
import { DbLogSink } from "@kagami/kernel/logger/sinks/db-sink";
import { createServiceApp } from "@kagami/kernel/http/service-app";
import { HealthHandler } from "@kagami/kernel/http/health.handler";
import { HttpMetricClient } from "@kagami/metric-client/client";
import { AlertService } from "../application/alert.service.js";
import { AlertThrottle } from "../application/alert-throttle.js";
import { LogService } from "../application/log.service.js";
import { pruneAppLogs } from "../application/log-prune.js";
import { NapcatAlertChannel } from "../infra/napcat-alert-channel.js";
import { closeDb, configureSqlite, createDbClient, type Database } from "../infra/db/client.js";
import { PrismaLogDao } from "../infra/impl/log.impl.dao.js";
import { AlertHandler } from "../http/alert.handler.js";
import { LogHandler } from "../http/log.handler.js";
import { loadObservatoryServiceConfig } from "./config.js";

const logger = new AppLogger({ source: "observatory-service-bootstrap" });

/** 本进程在 `app_log.service` 里的标识。 */
const SERVICE_NAME = "observatory";

/**
 * 日志摄取的请求体上限。Fastify 默认 1MB，而一批 100 条带 error stack 的日志能顶到它
 *（llm 服务已经踩过一次默认 bodyLimit 的 413）。8MB 对契约允许的 ≤500 条有充足余量。
 */
const INGEST_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

/** 保留清理周期。日志窗口是 7 天，一小时一次的粒度绰绰有余。 */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export type ObservatoryServiceRuntime = {
  app: FastifyInstance;
  port: number;
  database: Database;
  stopPrune: () => Promise<void>;
  /** 停掉自身日志 sink 的定时器并排空队列。必须在 closeDb **之前**调，否则残留日志无处可写。 */
  closeLogSink: () => Promise<void>;
};

/**
 * kagami-observatory 进程运行时装配（issue #602 告警 + #608 日志）。
 *
 * 告警：任何服务经 `POST /observatory/alert` 上报，observatory 渲染 → 按 (source, event)
 * 去重限流 → 投递到 QQ 告警群。去重窗口仍是**纯内存**（重启清零：最坏是重启后多发一条重复告警），
 * 不因为本进程有了库就改成持久化——那会把"最坏多发一条"换成一条没人要的写路径。
 *
 * 日志：各服务经 `POST /observatory/logs` 批量上报，落独占 SQLite 库；console 经
 * `POST /observatory/logs/query` 查回去。本进程**自己**的日志走 `DbLogSink` 直写本地库，
 * 绝不经 HTTP 打回自己（自噬 + 无谓回环）。
 *
 * 只绑 127.0.0.1、不过 gateway。用 createServiceApp 默认错误处理器：alert service 永不外抛，
 * log service 的 DB 故障走 500。
 */
export async function buildObservatoryServiceRuntime(): Promise<ObservatoryServiceRuntime> {
  const { port, alertGroupId, napcatBaseUrl, metricBaseUrl, databaseUrl } =
    await loadObservatoryServiceConfig();

  const database = createDbClient({ databaseUrl });
  await configureSqlite(database);
  const logDao = new PrismaLogDao({ database });

  // 自身日志直写本地库。放在 DAO 就绪之后、路由注册之前——装配期的日志也就都收得进去。
  const selfLogSink = new DbLogSink({ logDao, service: SERVICE_NAME });
  addLoggerSink(selfLogSink);

  const channel = new NapcatAlertChannel({ baseUrl: napcatBaseUrl, groupId: alertGroupId });
  const alertService = new AlertService({
    channel,
    throttle: new AlertThrottle(),
    metricService: new HttpMetricClient({ baseUrl: metricBaseUrl }),
  });
  const logService = new LogService({ logDao });

  const app = createServiceApp({
    logger,
    fastifyOptions: { bodyLimit: INGEST_BODY_LIMIT_BYTES },
    handlers: [
      new HealthHandler(),
      new AlertHandler({ service: alertService }),
      new LogHandler({ service: logService }),
    ],
  });

  // 保留清理（#608）：延迟一个周期首跑避开启动风暴；unref 不挡进程退出。
  //
  // 在途的那一轮必须被跟踪：只清 timer 就返回的话，关停撞上正在跑的 prune 时，DELETE 会落到
  // 随后 closeDb 断开的 client 上（而它的结果日志又落到已关闭的 sink 上）。
  let pruneInFlight: Promise<void> | null = null;
  const runPrune = async (): Promise<void> => {
    try {
      const deleted = await pruneAppLogs({ logDao, now: new Date() });
      if (deleted > 0) {
        logger.info("Pruned expired app logs", {
          event: "observatory.log.pruned",
          deleted,
        });
      }
    } catch (error) {
      logger.errorWithCause("Failed to prune app logs", error, {
        event: "observatory.log.prune_failed",
      });
    }
  };
  const pruneTimer = setInterval(() => {
    if (pruneInFlight) {
      return;
    }
    pruneInFlight = runPrune().finally(() => {
      pruneInFlight = null;
    });
  }, PRUNE_INTERVAL_MS);
  pruneTimer.unref?.();

  return {
    app,
    port,
    database,
    stopPrune: async () => {
      clearInterval(pruneTimer);
      await pruneInFlight;
    },
    closeLogSink: () => selfLogSink.close(),
  };
}

export { closeDb };
