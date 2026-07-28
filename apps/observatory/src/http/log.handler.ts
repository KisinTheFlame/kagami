import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { observatoryApiContract } from "@kagami/observatory-api/contract";
import type { LogService } from "../application/log.service.js";

/**
 * 日志摄取与查询路由（issue #608）。
 *
 * 两条都是服务间内部路由：摄取的调用方是各服务的 `HttpLogSink`，查询的调用方是 console
 *（管理台聚合层）。浏览器经 gateway 够不到本进程——gateway 的 `/app-log` 前缀仍指向 console。
 *
 * service 永不外抛业务异常，所以这里没有 try/catch：入参不合契约 → 400（createServiceApp 的
 * 默认 ZodError 出口），DB 故障 → 500，两者都是 sink 该丢批、console 该报错的正确信号。
 */
export class LogHandler {
  private readonly service: LogService;

  public constructor({ service }: { service: LogService }) {
    this.service = service;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, observatoryApiContract.ingestLogs, ({ input }) =>
      this.service.ingest(input),
    );
    registerJsonRoute(app, observatoryApiContract.queryLogs, ({ input }) =>
      this.service.query(input),
    );
  }
}
