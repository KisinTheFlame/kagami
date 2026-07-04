import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { createHealthResponse } from "@kagami/http/wire";
import { loadGatewayConfig } from "./config.js";

const config = loadGatewayConfig();
const distDir = config.distDir;
const indexPath = path.join(distDir, "index.html");
const port = config.port;
const apiTarget = config.agentTarget;
const consoleTarget = config.consoleTarget;
const llmTarget = config.llmTarget;
const metricTarget = config.metricTarget;
// 这些前缀的 /api 请求路由到 console 进程（管理台后端，纯 DB 查询）；其余仍到 server（agent）。
const CONSOLE_PATH_PREFIXES = [
  "/app-log",
  "/llm-chat-call",
  "/napcat-event",
  "/napcat-group-message",
  "/todo",
];
// 这些前缀路由到 kagami-llm 进程（OAuth 凭据中心）：认证管理端点已随 LLM 服务外移。
const LLM_PATH_PREFIXES = ["/auth"];
// metric-chart 查询走独立的 metric 进程（@kagami/metric）；摄取端点 /metric/* 不经网关（agent 直连）。
const METRIC_PATH_PREFIXES = ["/metric-chart"];
const HASHED_ASSET_NAME_PATTERN = /(?:^|[-.])[a-z0-9]{8,}(?=\.)/i;
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

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");

    if (requestUrl.pathname === "/health") {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      // 与其余服务共享 HealthResponseSchema 形状（{ status, timestamp }），监控探活全进程统一。
      res.end(JSON.stringify(createHealthResponse()));
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      await proxyApiRequest(req, res, requestUrl);
      return;
    }

    await serveStaticAsset(req, res, requestUrl);
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

function matchesAnyPrefix(upstreamPath: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => upstreamPath === prefix || upstreamPath.startsWith(`${prefix}/`));
}

function selectUpstreamTarget(upstreamPath: string): URL {
  if (matchesAnyPrefix(upstreamPath, METRIC_PATH_PREFIXES)) {
    return metricTarget;
  }

  if (matchesAnyPrefix(upstreamPath, LLM_PATH_PREFIXES)) {
    return llmTarget;
  }

  if (matchesAnyPrefix(upstreamPath, CONSOLE_PATH_PREFIXES)) {
    return consoleTarget;
  }

  return apiTarget;
}

async function proxyApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  requestUrl: URL,
): Promise<void> {
  const upstreamPath = requestUrl.pathname.slice(4) || "/";
  const target = selectUpstreamTarget(upstreamPath);
  const upstreamUrl = new URL(`${upstreamPath}${requestUrl.search}`, target);
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "undefined") {
      continue;
    }

    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  headers.set("host", target.host);

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

async function serveStaticAsset(
  req: IncomingMessage,
  res: ServerResponse,
  requestUrl: URL,
): Promise<void> {
  const assetPath = resolveAssetPath(requestUrl.pathname);
  const selectedPath = await resolveResponsePath(assetPath, req.headers.accept);

  if (!selectedPath) {
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const ext = path.extname(selectedPath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  res.writeHead(200, {
    "content-type": contentType,
    "cache-control": getCacheControlHeader(selectedPath),
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  try {
    // pipeline 在 res 关闭 / 读文件出错时 destroy 读流（autoClose 关 fd），杜绝 fd 泄漏。
    await pipeline(createReadStream(selectedPath), res);
  } catch (error) {
    // 响应头已发（200），无法改状态码；销毁 socket 断开即可。
    process.stderr.write(
      `[kagami-gateway] static stream failed for ${selectedPath}: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    res.destroy();
  }
}

function resolveAssetPath(pathname: string): string {
  const decodedPath = decodeURIComponent(pathname);
  const relativePath = decodedPath === "/" ? "/index.html" : decodedPath;
  const resolvedPath = path.resolve(distDir, `.${relativePath}`);

  if (!resolvedPath.startsWith(distDir)) {
    return indexPath;
  }

  return resolvedPath;
}

async function resolveResponsePath(
  targetPath: string,
  acceptHeader: string | undefined,
): Promise<string | null> {
  if (await fileExists(targetPath)) {
    return targetPath;
  }

  if (path.extname(targetPath).length > 0) {
    return null;
  }

  if (typeof acceptHeader === "string" && !acceptHeader.includes("text/html")) {
    return null;
  }

  return indexPath;
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const targetStat = await stat(targetPath);
    return targetStat.isFile();
  } catch {
    return false;
  }
}

function getCacheControlHeader(targetPath: string): string {
  if (targetPath === indexPath) {
    return "no-cache";
  }

  const relativePath = path.relative(distDir, targetPath);
  const normalizedPath = relativePath.split(path.sep).join("/");
  const fileName = path.basename(targetPath);

  if (normalizedPath.startsWith("assets/") && isHashedAsset(fileName)) {
    return "public, max-age=31536000, immutable";
  }

  if (isHashedAsset(fileName)) {
    return "public, max-age=31536000, immutable";
  }

  return "no-cache";
}

function isHashedAsset(fileName: string): boolean {
  return HASHED_ASSET_NAME_PATTERN.test(fileName);
}
