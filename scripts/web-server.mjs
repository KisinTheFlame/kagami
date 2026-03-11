import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/web/dist");
const indexPath = path.join(distDir, "index.html");
const port = Number(process.env.PORT ?? "20004");
const apiTarget = new URL(process.env.API_TARGET ?? "http://localhost:20003");
const HASHED_ASSET_NAME_PATTERN = /(?:^|[-.])[a-z0-9]{8,}(?=\.)/i;

const MIME_TYPES = {
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
      res.end(JSON.stringify({ ok: true }));
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
  process.stdout.write(`[kagami-web] listening on http://0.0.0.0:${port}\n`);
});

async function proxyApiRequest(req, res, requestUrl) {
  const upstreamPath = requestUrl.pathname.slice(4) || "/";
  const upstreamUrl = new URL(`${upstreamPath}${requestUrl.search}`, apiTarget);
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "undefined") {
      continue;
    }

    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  headers.set("host", apiTarget.host);

  const upstreamResponse = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
    duplex: req.method === "GET" || req.method === "HEAD" ? undefined : "half",
    redirect: "manual",
  });

  const responseHeaders = Object.fromEntries(upstreamResponse.headers.entries());
  res.writeHead(upstreamResponse.status, responseHeaders);

  if (!upstreamResponse.body || req.method === "HEAD") {
    res.end();
    return;
  }

  Readable.fromWeb(upstreamResponse.body).pipe(res);
}

async function serveStaticAsset(req, res, requestUrl) {
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

  createReadStream(selectedPath).pipe(res);
}

function resolveAssetPath(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const relativePath = decodedPath === "/" ? "/index.html" : decodedPath;
  const resolvedPath = path.resolve(distDir, `.${relativePath}`);

  if (!resolvedPath.startsWith(distDir)) {
    return indexPath;
  }

  return resolvedPath;
}

async function resolveResponsePath(targetPath, acceptHeader) {
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

async function fileExists(targetPath) {
  try {
    const targetStat = await stat(targetPath);
    return targetStat.isFile();
  } catch {
    return false;
  }
}

function getCacheControlHeader(targetPath) {
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

function isHashedAsset(fileName) {
  return HASHED_ASSET_NAME_PATTERN.test(fileName);
}
