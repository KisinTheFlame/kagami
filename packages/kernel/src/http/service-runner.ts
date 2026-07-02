import type { FastifyInstance } from "fastify";
import { AppLogger } from "../logger/logger.js";
import { initLoggerRuntime } from "../logger/runtime.js";
import { StdoutLogSink } from "../logger/sinks/stdout-sink.js";

/** 关停排空的统一上限：到点强制退出（.unref() 不阻塞事件循环），不靠 PM2 超时强杀。 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

export type ServiceHandle = {
  app: FastifyInstance;
  /**
   * 绑定地址，由服务在代码里显式决定（安全边界是代码级决策）：卫星服务一律 "127.0.0.1"，
   * 绝不对外网卡开放。config 的 `services.*.host` 语义是 reachable host（别的服务如何 reach 它），
   * 不是绑定地址——见 config.loader 的 ServiceEndpointSchema 注释。
   */
  bindHost: string;
  port: number;
  /** `app.close()` 排空后按序执行的清理步骤（关 DB / 停 timer / flush 存档…）。 */
  cleanup?: Array<() => void | Promise<void>>;
  /** listen 成功后执行的后台动作（如 browser 预热）。 */
  afterListen?: () => void;
};

type RunServiceOptions = {
  /** 日志事件前缀，如 "llm_service" → `llm_service.started`。 */
  name: string;
  /** AppLogger 的 source，如 "llm-service-bootstrap"。 */
  source: string;
  build: () => Promise<ServiceHandle>;
};

/**
 * 卫星服务共用的进程启动器（issue #274）：日志运行时初始化、全局崩溃兜底、信号驱动的
 * 优雅关停 + 强退兜底、listen 与启动失败退出。此前七个服务里只有 gateway 装了
 * uncaughtException / unhandledRejection 兜底，console / metric 关停缺强退，各 index.ts
 * 五份骨架互相漂移——收敛到这里，服务侧只写 build()（装配 + cleanup 清单）。
 *
 * 不适用的两个进程：agent（多 sink 日志 + 自己的运行时生命周期）、gateway（裸 node:http）。
 */
export function runService({ name, source, build }: RunServiceOptions): void {
  // 卫星服务日志只走 stdout（不写 app_log），请求日志由 PM2 的 <name>-out.log 承载。
  initLoggerRuntime({ sinks: [new StdoutLogSink()] });
  const logger = new AppLogger({ source });

  // 未预期异常兜底：记结构化诊断后退出（1），交给 PM2 干净重启，而不是让进程带着
  // 损坏状态硬崩、丢掉崩溃原因。
  process.on("uncaughtException", error => {
    logger.errorWithCause("Uncaught exception, exiting", error, {
      event: `${name}.uncaught_exception`,
    });
    process.exit(1);
  });
  process.on("unhandledRejection", reason => {
    logger.errorWithCause("Unhandled rejection, exiting", reason, {
      event: `${name}.unhandled_rejection`,
    });
    process.exit(1);
  });

  let handle: ServiceHandle | null = null;
  let isShuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS).unref();

    void (async () => {
      try {
        if (handle) {
          await handle.app.close();
          for (const step of handle.cleanup ?? []) {
            await step();
          }
        }
      } catch (error) {
        logger.errorWithCause("Service shutdown error", error, {
          event: `${name}.shutdown.error`,
          signal,
        });
      }
      process.exit(0);
    })();
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });

  void (async () => {
    try {
      handle = await build();
      await handle.app.listen({ host: handle.bindHost, port: handle.port });
      logger.info("Service started", {
        event: `${name}.started`,
        host: handle.bindHost,
        port: handle.port,
        pid: process.pid,
      });
      handle.afterListen?.();
    } catch (error) {
      logger.errorWithCause("Service failed to start", error, {
        event: `${name}.start.failed`,
      });
      // 启动失败也尽力清理已建资源（DB 连接等），单步失败不阻断后续步骤。
      for (const step of handle?.cleanup ?? []) {
        await Promise.resolve()
          .then(step)
          .catch(() => undefined);
      }
      process.exit(1);
    }
  })();
}
