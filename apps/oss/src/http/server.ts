import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { ObjectStore } from "../store/object-store.js";

const OBJECT_PATH = /^\/objects\/([^/]+)$/;

class BodyTooLargeError extends Error {}

export function createOssServer(store: ObjectStore, maxBodyBytes: number): Server {
  return createServer((req, res) => {
    void handleRequest(req, res, store, maxBodyBytes);
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: ObjectStore,
  maxBodyBytes: number,
): Promise<void> {
  try {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;

    if (req.method === "GET" && pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }

    if (pathname === "/objects" && req.method === "POST") {
      await handlePost(req, res, store, maxBodyBytes);
      return;
    }

    const match = OBJECT_PATH.exec(pathname);
    if (match) {
      const key = decodeURIComponent(match[1]);
      switch (req.method) {
        case "GET":
          await handleGet(res, store, key);
          return;
        case "HEAD":
          await handleHead(res, store, key);
          return;
        case "DELETE":
          await handleDelete(res, store, key);
          return;
        default:
          res.writeHead(405).end();
          return;
      }
    }

    res.writeHead(404).end();
  } catch (error) {
    console.error("[oss] request failed", error);
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end();
  }
}

async function handlePost(
  req: IncomingMessage,
  res: ServerResponse,
  store: ObjectStore,
  maxBodyBytes: number,
): Promise<void> {
  let bytes: Buffer;
  try {
    bytes = await readBody(req, maxBodyBytes);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      res.writeHead(413).end();
      return;
    }
    throw error;
  }
  const mime = parseMime(req.headers["content-type"]);
  const { key } = await store.put(bytes, mime);
  res.writeHead(201, { "content-type": "application/json" });
  res.end(JSON.stringify({ key }));
}

async function handleGet(res: ServerResponse, store: ObjectStore, key: string): Promise<void> {
  let result;
  try {
    result = await store.get(key);
  } catch (error) {
    // key 有映射但物理文件读失败 → 500（区分"没存过"的 404）。
    console.error(`[oss] get failed for ${key}`, error);
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
  res.end(result.bytes);
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

async function readBody(req: IncomingMessage, maxBodyBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > maxBodyBytes) {
      req.destroy();
      throw new BodyTooLargeError();
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function parseMime(contentType: string | undefined): string {
  const mime = contentType?.split(";")[0]?.trim();
  return mime && mime.length > 0 ? mime : "application/octet-stream";
}
