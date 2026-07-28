import { loadStaticConfig } from "@kagami/kernel/config/config.loader";
import type { LogSink } from "@kagami/kernel/logger/types";
import { HttpLogSink } from "./log-sink.js";

/**
 * 各服务给 `runService({ logSinks })` 用的工厂（issue #608）：读 config 拿 observatory 地址，
 * 造一个 `HttpLogSink`。
 *
 * 返回数组而非单个 sink，是为了对齐 `runService` 的注入形状——将来要多挂一路 sink（比如
 * 本地文件归档）时，调用点一行都不用改。
 *
 * 抛错由 `runService` 兜（记 stderr 后照常启动），这里不吞：config 读不出来是启动期的真问题，
 * 应该在 PM2 error.log 里留痕，而不是静默退化成"日志查不到"。
 *
 * observatory 自己**不该**用它——它持有 app_log 表，走 kernel 的 `DbLogSink` 直写本地库。
 */
export async function createHttpLogSinks({ service }: { service: string }): Promise<LogSink[]> {
  const config = await loadStaticConfig();
  const { host, port } = config.services.observatory;
  return [new HttpLogSink({ baseUrl: `http://${host}:${String(port)}`, service })];
}
