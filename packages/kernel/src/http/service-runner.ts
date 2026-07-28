import type { FastifyInstance } from "fastify";
import { AppLogger } from "../logger/logger.js";
import { addLoggerSink, getLoggerRuntime, initLoggerRuntime } from "../logger/runtime.js";
import { StdoutLogSink } from "../logger/sinks/stdout-sink.js";
import type { LogSink } from "../logger/types.js";

/** 关停排空的统一上限：到点强制退出（.unref() 不阻塞事件循环），不靠 PM2 超时强杀。 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * 崩溃退出前留给日志排空的窗口。取 3s：略大于 HttpLogSink 单次上报的 2s 超时，够它把最后一批
 * （含刚写的崩溃日志）送出去，又不至于让 PM2 的重启明显变慢。
 */
const FATAL_FLUSH_TIMEOUT_MS = 3_000;

export type ServiceHandle = {
  app: FastifyInstance;
  /**
   * 绑定地址，由服务在代码里显式决定（安全边界是代码级决策）：卫星服务一律 "127.0.0.1"，
   * 绝不对外网卡开放。config 的 `services.*.host` 语义是 reachable host（别的服务如何 reach 它），
   * 不是绑定地址——见 config.loader 的 ServiceEndpointSchema 注释。
   */
  bindHost: string;
  port: number;
  /**
   * `app.close()` **之前**执行的步骤：停掉会在排空窗口内继续产生新工作的后台源
   * （如 llm 的 auth 刷新 timer——排空可长至 10s，期间 timer 若还在跑，其 fire-and-forget
   * DB 写会与后续 closeDb 竞态）。
   */
  beforeClose?: Array<() => void | Promise<void>>;
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
  /**
   * 额外日志 sink 的工厂（issue #608）。在 `build()` **之前** await，产出的 sink 逐个
   * `addLoggerSink`，其 `close()` 自动挂进关停清理（排在服务自己的 cleanup 之后，让服务关停
   * 期间产生的日志也能被最后一次 flush 带走）。
   *
   * kernel 不能自己造这个 sink：日志上报走 `@kagami/rpc-client`，而 rpc-client 依赖 kernel，
   * 反向依赖会成环。所以 sink 住在 `@kagami/observatory-client`，由各服务经本回调注入。
   *
   * **失败不挡启动**：工厂抛错只记 stderr 然后继续——日志上报是可观测性，不是服务的功能依赖。
   */
  logSinks?: () => Promise<LogSink[]>;
};

/**
 * 卫星服务共用的进程启动器（issue #274）：日志运行时初始化、全局崩溃兜底、信号驱动的
 * 优雅关停 + 强退兜底、listen 与启动失败退出。此前七个服务里只有 gateway 装了
 * uncaughtException / unhandledRejection 兜底，console / metric 关停缺强退，各 index.ts
 * 五份骨架互相漂移——收敛到这里，服务侧只写 build()（装配 + cleanup 清单）。
 *
 * 不适用的两个进程：agent（多 sink 日志 + 自己的运行时生命周期）、gateway（裸 node:http）。
 */
export function runService({ name, source, build, logSinks }: RunServiceOptions): void {
  // 起步只给 stdout：config 还没读，日志上报 sink 还造不出来。配置就绪后由 logSinks 追加
  //（issue #608）。stdout 这一路始终在，是 observatory 不可达时的兜底副本（PM2 <name>-out.log）。
  initLoggerRuntime({ sinks: [new StdoutLogSink()] });
  const logger = new AppLogger({ source });

  /**
   * 关停时排空日志：`LoggerRuntime.close()` 会逐个 flush + close 所有 sink（含 logSinks 注入的
   * HttpLogSink），单个 sink 抛错由 runtime 内部记 stderr 后咽下。与 agent 进程的关停语义一致。
   */
  const closeLogging = async (): Promise<void> => {
    await getLoggerRuntime().close();
  };

  /**
   * 崩溃退出：记诊断 → **给日志一个有界的排空窗口** → exit(1) 交 PM2 重启。
   *
   * 那个窗口不是可有可无的：`HttpLogSink` 是异步上报的，直接 exit 会让崩溃日志永远到不了
   * observatory——而崩溃日志恰恰是最需要能在管理台查到的那一条。stderr 那一路本来就同步落
   * PM2 error.log，所以最坏情况也只是退化回今天的水平。
   */
  const fatalExit = (event: string, message: string, error: unknown): void => {
    logger.errorWithCause(message, error, { event });
    const forceExit = setTimeout(() => process.exit(1), FATAL_FLUSH_TIMEOUT_MS);
    forceExit.unref?.();
    void closeLogging().finally(() => {
      clearTimeout(forceExit);
      process.exit(1);
    });
  };

  // 未预期异常兜底：记结构化诊断后退出（1），交给 PM2 干净重启，而不是让进程带着
  // 损坏状态硬崩、丢掉崩溃原因。
  process.on("uncaughtException", error => {
    fatalExit(`${name}.uncaught_exception`, "Uncaught exception, exiting", error);
  });
  process.on("unhandledRejection", reason => {
    fatalExit(`${name}.unhandled_rejection`, "Unhandled rejection, exiting", reason);
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
          for (const step of handle.beforeClose ?? []) {
            await step();
          }
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
      // 最后收口日志：放在服务 cleanup 之后，让关停期间产生的日志也进得了最后一次 flush。
      await closeLogging();
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
      if (logSinks) {
        // 失败不挡启动：拿不到 observatory 地址 / 建 client 失败，服务照常起来，日志退回 stdout。
        try {
          for (const sink of await logSinks()) {
            addLoggerSink(sink);
          }
        } catch (error) {
          process.stderr.write(
            `${JSON.stringify({
              event: `${name}.log_sink_init_failed`,
              timestamp: new Date().toISOString(),
              error: error instanceof Error ? error.message : String(error),
            })}\n`,
          );
        }
      }

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
      // 置位关停闸：启动失败清理期间若来信号，shutdown 直接短路，避免同一批清理步骤并发跑两遍。
      isShuttingDown = true;
      // 启动失败也尽力清理已建资源（DB 连接等），单步失败不阻断后续步骤。
      for (const step of [...(handle?.beforeClose ?? []), ...(handle?.cleanup ?? [])]) {
        await Promise.resolve()
          .then(step)
          .catch(() => undefined);
      }
      await closeLogging();
      process.exit(1);
    }
  })();
}
