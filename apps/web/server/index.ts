// kagami-web：管理台前端的独立进程，自己托管自己的构建产物（issue #578）。
//
// 在此之前前端产物由 kagami-gateway 托管——gateway 得在 build 期把 apps/web/dist 拷进自己的
// dist/public（#496），两个 app 的构建与生命周期被焊死。现在 web 有了自己的进程：gateway 退化
// 成纯反代（非 /api 的请求原样转给这里），web 自己发自己的文件，两边只剩一条 HTTP 边界。
//
// 仍然只绑 127.0.0.1：浏览器唯一入口依旧是 gateway，这个进程不对外。

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createHealthResponse } from "@kagami/http/wire";
import { loadWebServerConfig } from "./config.js";
import {
  getCacheControlHeader,
  getContentType,
  resolveAssetPath,
  selectMissingAssetFallback,
} from "./static-resolve.js";

const config = loadWebServerConfig();
// 运行时 index.js 位于 apps/web/dist/server/，前端产物在同级的 dist/client/（vite 的 outDir）。
const staticDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "client");
const indexPath = path.join(staticDir, "index.html");
// 绑定地址是本服务自己的安全决策（config 里的 host 语义是"别人如何 reach 我"）：卫星进程
// 一律只绑回环，前门只有 gateway 一个。
const BIND_HOST = "127.0.0.1";
// 关停时等待在途连接排空的上限，到点强制退出，与 gateway / oss / llm 等进程一致。
const SHUTDOWN_TIMEOUT_MS = 10_000;

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

    await serveStaticAsset(req, res, requestUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: message }));
  }
});

server.listen(config.port, BIND_HOST, () => {
  process.stdout.write(`[kagami-web] listening on http://${BIND_HOST}:${config.port}\n`);
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  process.stdout.write(`[kagami-web] ${signal} received, shutting down\n`);
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

// 未预期异常兜底：请求处理器已 try/catch，这里只接漏网的 bug。记结构化诊断后退出（1），
// 交给 PM2 干净重启，而不是让进程带着损坏状态硬崩、丢掉崩溃原因。
process.on("uncaughtException", error => {
  process.stderr.write(
    `[kagami-web] uncaughtException, exiting: ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }\n`,
  );
  process.exit(1);
});
process.on("unhandledRejection", reason => {
  process.stderr.write(
    `[kagami-web] unhandledRejection, exiting: ${
      reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
    }\n`,
  );
  process.exit(1);
});

async function serveStaticAsset(
  req: IncomingMessage,
  res: ServerResponse,
  requestUrl: URL,
): Promise<void> {
  const assetPath = resolveAssetPath(requestUrl.pathname, staticDir, indexPath);
  const selectedPath = (await fileExists(assetPath))
    ? assetPath
    : selectMissingAssetFallback(assetPath, req.headers.accept, indexPath);

  if (!selectedPath) {
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  res.writeHead(200, {
    "content-type": getContentType(selectedPath),
    "cache-control": getCacheControlHeader(selectedPath, indexPath),
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
      `[kagami-web] static stream failed for ${selectedPath}: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    res.destroy();
  }
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const targetStat = await stat(targetPath);
    return targetStat.isFile();
  } catch {
    return false;
  }
}
