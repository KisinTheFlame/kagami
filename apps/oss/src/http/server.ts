import type { ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import {
  registerBinaryEnvelopeRoute,
  registerBinaryRawRoute,
  useRawBodyPassthrough,
} from "@kagami/http/contract";
import { ossApiContract } from "@kagami/oss-api/contract";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { createServiceApp, type ServiceErrorHandler } from "@kagami/kernel/http/service-app";
import { HealthHandler } from "@kagami/kernel/http/health.handler";
import { PayloadTooLargeError } from "../store/object-store.js";
import type { ObjectStore } from "../store/object-store.js";

const logger = new AppLogger({ source: "oss-http" });

/**
 * OSS 的 Fastify 应用。路由全量走 @kagami/oss-api 契约（issue #230）：putObject 是二进制信封路由
 * （上行原始字节流透传、下行 `{ key }` 信封两端共享 schema），get/head/delete 是 raw 路由——
 * `reply.hijack()` 后在裸 ServerResponse 上原样保留迁移前的流式管道 / fd 生命周期 / 安全头逻辑
 * （下方三个 handle* 函数从裸 node:http 实现逐行搬运，行为由 test/server.test.ts 的传输层基线钉死）。
 */
export function buildOssApp(store: ObjectStore, maxBodyBytes: number): FastifyInstance {
  const errorHandler: ServiceErrorHandler = (error, _request, reply) => {
    // store 超限时刻意不销毁 req；先把 413 写回再收尾，客户端能看到 413 而非 ECONNRESET。
    // bodyLimit 的早拒（FST_ERR_CTP_BODY_TOO_LARGE，statusCode 413）归并同一出口。
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (error instanceof PayloadTooLargeError || statusCode === 413) {
      if (!reply.sent) {
        void reply.code(413).header("connection", "close").send();
      }
      return;
    }
    logger.errorWithCause("OSS request failed", error, { event: "oss.http.request_failed" });
    if (!reply.sent) {
      void reply.code(500).send();
    }
  };

  return createServiceApp({
    logger,
    fastifyOptions: {
      // GET /objects/:key 之外显式配了 HEAD 路由，关掉 Fastify 自动 HEAD 以免撞路由。
      exposeHeadRoutes: false,
      // content-length 声明超限的上传直接 413 早拒；chunked / 谎报长度的由 store.put 按实际字节兜底。
      bodyLimit: maxBodyBytes,
      // close() 时强制断开 keep-alive 空闲连接：与旧裸 node:http 版"close + 10s 超时兜底"同一语义，
      // 否则复用连接的客户端（undici 池）会让优雅关停一直等到超时。
      forceCloseConnections: true,
    },
    errorHandler,
    configure: app => {
      // 上行 body 一律原始流透传（含 application/json——对 OSS 它也只是不透明字节）。
      useRawBodyPassthrough(app);

      // 缺失 / 空 content-type 的上传按 application/octet-stream 收（与旧实现一致）：不归一化的话
      // Fastify 会把空 content-type 走错误路径拒掉，而对 OSS 它只是"未声明类型的字节"。
      app.addHook("onRequest", (request, _reply, done) => {
        const contentType = request.headers["content-type"];
        if (contentType === undefined || contentType === "") {
          request.headers["content-type"] = "application/octet-stream";
        }
        done();
      });
    },
    handlers: [
      new HealthHandler(),
      {
        register: app => {
          registerOssRoutes(app, store, maxBodyBytes);
        },
      },
    ],
  });
}

function registerOssRoutes(app: FastifyInstance, store: ObjectStore, maxBodyBytes: number): void {
  registerBinaryEnvelopeRoute(app, ossApiContract.putObject, async ({ body, request }) => {
    if (!body) {
      throw new Error("[oss] putObject 缺少上行字节流（bytesIn 路由不应至此）");
    }
    const mime = parseMime(request.headers["content-type"]);
    // 请求体直接作为流交给 store，边流边算 sha256 落临时文件，不整块驻留内存。
    return await store.put(body, mime, { maxBytes: maxBodyBytes });
  });

  registerBinaryRawRoute(app, ossApiContract.getObject, async ({ params, raw }) => {
    await handleGet(raw, store, params.key);
  });

  registerBinaryRawRoute(app, ossApiContract.headObject, async ({ params, raw }) => {
    await handleHead(raw, store, params.key);
  });

  registerBinaryRawRoute(app, ossApiContract.deleteObject, async ({ params, raw }) => {
    await handleDelete(raw, store, params.key);
  });
}

async function handleGet(res: ServerResponse, store: ObjectStore, key: string): Promise<void> {
  let result;
  try {
    result = await store.get(key);
  } catch (error) {
    // key 有映射但物理文件打开失败 → 500（区分"没存过"的 404）。
    logger.errorWithCause(`OSS get failed for ${key}`, error, { event: "oss.get_failed", key });
    res.writeHead(500).end();
    return;
  }
  if (!result) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": result.mime,
    "content-length": String(result.size),
    // 内容由上传方决定、业务无关：强制 nosniff + attachment，杜绝把存进来的
    // text/html、image/svg+xml 等当作可执行内容内联渲染（若 /objects/* 被同源反代则是存储型 XSS）。
    "x-content-type-options": "nosniff",
    "content-disposition": "attachment",
  });
  try {
    // pipeline 会在 res 关闭 / 出错时 destroy result.stream（autoClose 关 fd），杜绝 fd 泄漏。
    await pipeline(result.stream, res);
  } catch (error) {
    // header 已发，无法改状态码；销毁 socket 断开，让流被 destroy（fd 关闭）。
    logger.errorWithCause(`OSS get stream failed for ${key}`, error, {
      event: "oss.get_stream_failed",
      key,
    });
    res.destroy();
  }
}

async function handleHead(res: ServerResponse, store: ObjectStore, key: string): Promise<void> {
  const meta = await store.head(key);
  if (!meta) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": meta.mime,
    "content-length": String(meta.size),
    "x-oss-sha256": meta.sha256,
    "x-content-type-options": "nosniff",
    "content-disposition": "attachment",
  });
  res.end();
}

async function handleDelete(res: ServerResponse, store: ObjectStore, key: string): Promise<void> {
  const removed = await store.delete(key);
  res.writeHead(removed ? 204 : 404).end();
}

function parseMime(contentType: string | undefined): string {
  const mime = contentType?.split(";")[0]?.trim();
  return mime && mime.length > 0 ? mime : "application/octet-stream";
}
