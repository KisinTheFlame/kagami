import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { BizError } from "../errors/biz-error.js";
import { toHttpErrorResponse } from "../errors/http-error.js";
import type { AppLogger } from "../logger/logger.js";
import { withTraceContext } from "../logger/runtime.js";

const TRACE_ID_HEADER_NAME = "X-Kagami-Trace-Id";

export type AppRouteHandler = {
  register(app: FastifyInstance): void;
};

export type ServiceErrorHandler = (
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) => unknown;

type CreateServiceAppOptions = {
  handlers: AppRouteHandler[];
  /** 默认错误处理器的日志出口；传了自定义 errorHandler 时不被使用。 */
  logger: AppLogger;
  /** 透传给 Fastify 构造的少数可变项（llm 的 bodyLimit、oss 的 HEAD 路由 / 强断连）。 */
  fastifyOptions?: {
    bodyLimit?: number;
    exposeHeadRoutes?: boolean;
    forceCloseConnections?: boolean;
  };
  /**
   * 覆盖默认错误处理器。默认三分支面向前端查询服务（console / metric）：ZodError → 400、
   * BizError → toHttpErrorResponse、其余 → 500。内部 RPC 服务各有领域错误信封
   * （llm 的 BizErrorWire、browser 的 BrowserError wire、spire / oss 的自有形状），从这里传入。
   */
  errorHandler?: ServiceErrorHandler;
  /** 注册路由前对 app 的进一步定制（如 oss 的原始字节流透传 parser 与 content-type 归一 hook）。 */
  configure?: (app: FastifyInstance) => void;
};

/**
 * 卫星服务共用的 Fastify 装配壳（issue #274）：traceId 注入、统一错误出口、handler 注册。
 * 此前 browser / console / llm / metric / spire 五份装配各自复制这段样板，关停 / 错误分支
 * 细节随复制漂移——收敛到这里，服务侧只留领域差异（handlers / errorHandler / fastifyOptions）。
 */
export function createServiceApp(options: CreateServiceAppOptions): FastifyInstance {
  const app = Fastify({
    logger: false,
    disableRequestLogging: true,
    ...options.fastifyOptions,
  });

  app.addHook("onRequest", (_request, reply, done) => {
    const traceId = randomUUID();
    reply.header(TRACE_ID_HEADER_NAME, traceId);

    withTraceContext(traceId, () => {
      done();
    });
  });

  app.setErrorHandler(options.errorHandler ?? createDefaultErrorHandler(options.logger));

  options.configure?.(app);

  for (const handler of options.handlers) {
    handler.register(app);
  }

  return app;
}

function createDefaultErrorHandler(logger: AppLogger): ServiceErrorHandler {
  return (error, request, reply) => {
    if (error instanceof z.ZodError) {
      logger.warn("Request validation failed", {
        event: "http.request.validation_failed",
        method: request.method,
        url: request.url,
        issues: error.issues,
      });

      return reply.code(400).send({
        message: "请求参数不合法",
      });
    }

    if (error instanceof BizError) {
      logger.errorWithCause("Handled business request error", error, {
        event: "http.request.biz_error",
        method: request.method,
        url: request.url,
        ...(error.meta ?? {}),
      });

      const response = toHttpErrorResponse(error);
      return reply.code(response.statusCode).send(response.body);
    }

    logger.errorWithCause("Unhandled request error", error, {
      event: "http.request.unhandled_error",
      method: request.method,
      url: request.url,
    });

    return reply.code(500).send({
      message: "服务器内部错误",
    });
  };
}
