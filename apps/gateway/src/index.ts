// kagami-gateway：浏览器的唯一前门。自 #578 起是**纯反向代理**——`/api/*` 按前缀分流到各后端
// 进程，其余（前端页面与静态资源）原样转给 kagami-web。网关自身不再托管任何文件：前端产物由
// web 进程自持，两个 app 之间只剩一条 HTTP 边界，不再有构建期的 dist 装配耦合（原 #496 方案）。

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { createHealthResponse } from "@kagami/http/wire";
import { loadGatewayConfig } from "./config.js";
import { selectFrontDoor, selectUpstreamKey, type UpstreamKey } from "./routing.js";

const config = loadGatewayConfig();
const port = config.port;
// UpstreamKey → 具体上游地址；路由决策（路径 → key）在 routing.ts，这里只做 key → URL 映射。
const UPSTREAM_TARGETS: Record<UpstreamKey, URL> = {
  metric: config.metricTarget,
  llm: config.llmTarget,
  console: config.consoleTarget,
  oss: config.ossTarget,
  scheduler: config.schedulerTarget,
  gba: config.gbaTarget,
  agent: config.agentTarget,
};
// 上游响应超时：等待上游返回响应头的上限。命中即回 504，避免上游卡死 / 半开时前端连接
// 永久悬挂、socket 句柄泄漏。只约束"拿到响应头"这一段——响应头一到就清除，故不会打断
// 合法的长响应体流式传输（大文件 / SSE）。
const UPSTREAM_RESPONSE_TIMEOUT_MS = 30_000;
// 关停时等待在途连接排空的上限，到点强制退出，与 oss / llm / browser 进程一致。
const SHUTDOWN_TIMEOUT_MS = 10_000;
// 逐跳（hop-by-hop）头：只在单个 TCP 连接内有意义，反代时必须剥离而非透传给客户端（RFC 7230 §6.1）。
// transfer-encoding 尤其关键——Node 会按响应体自行重新分帧，透传上游的旧值会破坏响应帧。
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");

    switch (selectFrontDoor(requestUrl.pathname)) {
      case "health": {
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        // 与其余服务共享 HealthResponseSchema 形状（{ status, timestamp }），监控探活全进程统一。
        // 网关自答，不代理到 web——探的是前门自身的活性。
        res.end(JSON.stringify(createHealthResponse()));
        return;
      }
      case "api": {
        // 剥掉 `/api` 前缀后按路径前缀选后端；契约 path 自带各自前缀，故上游看到的路径不含 /api。
        const upstreamPath = requestUrl.pathname.slice(4) || "/";
        const target = UPSTREAM_TARGETS[selectUpstreamKey(upstreamPath)];
        await proxyRequest(req, res, buildUpstreamUrl(target, upstreamPath, requestUrl.search));
        return;
      }
      case "web": {
        // 前端页面与静态资源：路径原样透传给 kagami-web（含 query），由它做 SPA 回退与缓存头。
        await proxyRequest(
          req,
          res,
          buildUpstreamUrl(config.webTarget, requestUrl.pathname, requestUrl.search),
        );
        return;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: message }));
  }
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`[kagami-gateway] listening on http://0.0.0.0:${port}\n`);
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  process.stdout.write(`[kagami-gateway] ${signal} received, shutting down\n`);
  const finish = (): void => {
    process.exit(0);
  };
  // 停止收新连接，排空在途请求后退出；到点未排空则强制退出（.unref() 不阻塞事件循环）。
  server.close(finish);
  setTimeout(finish, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});

// 未预期异常兜底：请求处理器已各自 try/catch，这里只接漏网的 bug。记结构化诊断后退出（1），
// 交给 PM2 干净重启，而不是让进程带着损坏状态硬崩、丢掉崩溃原因。
process.on("uncaughtException", error => {
  process.stderr.write(
    `[kagami-gateway] uncaughtException, exiting: ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }\n`,
  );
  process.exit(1);
});
process.on("unhandledRejection", reason => {
  process.stderr.write(
    `[kagami-gateway] unhandledRejection, exiting: ${
      reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
    }\n`,
  );
  process.exit(1);
});

/**
 * 拼上游 URL：克隆上游基址后赋 pathname / search，**绝不用 `new URL(相对路径, base)`**。
 *
 * 相对拼接会把 `//evil.example/x` 当协议相对 URL 解析，直接把 origin 换成外部主机——网关就成了
 * 任意外部地址的 SSRF 跳板（`GET /api//evil.example/x` 即可触发）。赋 pathname 则 origin 不可
 * 被劫持，畸形路径最多变成上游的一个怪路径（由上游自己 404），出不去内网。
 */
function buildUpstreamUrl(target: URL, pathname: string, search: string): URL {
  const upstreamUrl = new URL(target);
  upstreamUrl.pathname = pathname;
  upstreamUrl.search = search;
  return upstreamUrl;
}

/**
 * 把一条请求整体转发到指定上游并回灌响应。上游是谁由调用方决定（`/api` 分流的后端，或
 * kagami-web），本函数只管转发语义：逐跳头剥离、超时、流式回灌、错误映射。
 */
async function proxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  upstreamUrl: URL,
): Promise<void> {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "undefined") {
      continue;
    }
    // 请求侧同样剥离逐跳头；另外剥 expect——curl 等客户端对 >1MB body 自动加
    // `Expect: 100-continue`,而 undici fetch 不支持该机制,原样转发会让整个上游请求
    // 直接 fetch failed(首个受害者:GBA ROM 上传,#541 PR3)。node:http 已在入站侧
    // 处理过 100-continue 握手,上游无需再见到这个头。
    if (HOP_BY_HOP_HEADERS.has(key) || key === "expect") {
      continue;
    }

    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  headers.set("host", upstreamUrl.host);

  // 只给"拿到响应头"这一段设超时：拿到响应后立即 clearTimeout，body 流式阶段不受限，
  // 避免误伤合法长响应。abort 后 fetch 抛错，走下方 catch 回 504。
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_RESPONSE_TIMEOUT_MS);

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body:
        req.method === "GET" || req.method === "HEAD" ? undefined : (req as unknown as BodyInit),
      duplex: req.method === "GET" || req.method === "HEAD" ? undefined : "half",
      redirect: "manual",
      signal: controller.signal,
    } as RequestInit & { duplex?: "half" });
  } catch (error) {
    // 响应头尚未发出，可安全改状态码：超时 → 504，其余连接失败 → 502。
    const timedOut = controller.signal.aborted;
    const message = error instanceof Error ? error.message : "Upstream request failed";
    res.writeHead(timedOut ? 504 : 502, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: timedOut ? "Upstream timeout" : message }));
    return;
  } finally {
    clearTimeout(timeout);
  }

  // 剥离逐跳头再回灌：fetch 的 Headers 键已小写，直接按集合判定。
  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of upstreamResponse.headers.entries()) {
    if (HOP_BY_HOP_HEADERS.has(key)) {
      continue;
    }
    responseHeaders[key] = value;
  }
  res.writeHead(upstreamResponse.status, responseHeaders);

  if (!upstreamResponse.body || req.method === "HEAD") {
    res.end();
    return;
  }

  // fetch 返回的是 DOM 流类型，Readable.fromWeb 要的是 node:stream/web 的流；两者运行时一致，仅类型分叉，故收窄转换。
  const body = Readable.fromWeb(
    upstreamResponse.body as unknown as NodeWebReadableStream<Uint8Array>,
  );
  try {
    // pipeline 在 res 关闭 / 上游流出错时 destroy body（取消底层 fetch、释放 socket），杜绝句柄泄漏。
    await pipeline(body, res);
  } catch (error) {
    // 响应头已发，无法改状态码；销毁 socket 断开，让 body 被 destroy。
    process.stderr.write(
      `[kagami-gateway] proxy stream failed for ${upstreamUrl.pathname}: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    res.destroy();
  }
}
