import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import { StdoutLogSink } from "@kagami/kernel/logger/sinks/stdout-sink";
import { buildOssApp } from "../src/http/server.js";
import { ObjectStore } from "../src/store/object-store.js";

// server / store 经 AppLogger 打日志（issue #274 统一日志格式），emit 前必须先初始化运行时。
initLoggerRuntime({ sinks: [new StdoutLogSink()] });

const MAX_BODY_BYTES = 64 * 1024; // 测试用小上限，机制与生产 50MB 完全一致。

let blobDir: string;
let db: Database.Database;
let store: ObjectStore;
let app: FastifyInstance;
let baseUrl: string;

beforeEach(async () => {
  blobDir = await mkdtemp(path.join(tmpdir(), "oss-http-"));
  db = new Database(":memory:");
  store = new ObjectStore({ db, blobDir });
  app = buildOssApp(store, MAX_BODY_BYTES);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await app.close();
  db.close();
  await rm(blobDir, { recursive: true, force: true });
});

async function countTmpFiles(): Promise<number> {
  try {
    const entries = await readdir(path.join(blobDir, "tmp"));
    return entries.filter(name => name.includes(".tmp-")).length;
  } catch {
    return 0;
  }
}

describe("OSS HTTP server (streaming)", () => {
  it("POST 超上限 → 客户端收到真实 413(非 ECONNRESET), 无 tmp 残留", async () => {
    const tooBig = randomBytes(MAX_BODY_BYTES * 4);
    const res = await fetch(`${baseUrl}/objects`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: tooBig,
    });
    expect(res.status).toBe(413);
    await res.arrayBuffer().catch(() => {}); // 排空响应体
    expect(await countTmpFiles()).toBe(0);
  });

  it("POST 上限内 → 201 + key, 随后 GET → 200 流式回原字节 + content-length", async () => {
    const payload = randomBytes(MAX_BODY_BYTES - 1024);
    const postRes = await fetch(`${baseUrl}/objects`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: payload,
    });
    expect(postRes.status).toBe(201);
    const { key } = (await postRes.json()) as { key: string };
    expect(key).toMatch(/^res-\d+$/);

    const getRes = await fetch(`${baseUrl}/objects/${key}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("content-length")).toBe(String(payload.length));
    expect(getRes.headers.get("content-type")).toBe("application/octet-stream");
    const got = Buffer.from(await getRes.arrayBuffer());
    expect(got.equals(payload)).toBe(true);
  });

  it("GET 未知 key → 404", async () => {
    const res = await fetch(`${baseUrl}/objects/res-999`);
    expect(res.status).toBe(404);
  });

  // —— 以下为 Fastify 迁移的行为基线（issue #230）：先在裸 node:http 实现上跑绿，迁移后原样通过 ——

  it("GET 安全头冻结：nosniff + attachment + 自定义 mime 原样回", async () => {
    const postRes = await fetch(`${baseUrl}/objects`, {
      method: "POST",
      headers: { "content-type": "image/svg+xml" },
      body: "<svg/>",
    });
    const { key } = (await postRes.json()) as { key: string };

    const getRes = await fetch(`${baseUrl}/objects/${key}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("content-type")).toBe("image/svg+xml");
    expect(getRes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(getRes.headers.get("content-disposition")).toBe("attachment");
    expect(await getRes.text()).toBe("<svg/>");
  });

  it("POST 无 content-type → mime 落为 application/octet-stream", async () => {
    // fetch 会给 string body 自动补 text/plain，改用 Uint8Array + 显式删头做不到——直接给空串头。
    const postRes = await fetch(`${baseUrl}/objects`, {
      method: "POST",
      headers: { "content-type": "" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(postRes.status).toBe(201);
    const { key } = (await postRes.json()) as { key: string };
    const head = await fetch(`${baseUrl}/objects/${key}`, { method: "HEAD" });
    expect(head.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("HEAD：200 + content-length + x-oss-sha256 + 安全头；未知 key → 404", async () => {
    const payload = randomBytes(2048);
    const postRes = await fetch(`${baseUrl}/objects`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: payload,
    });
    const { key } = (await postRes.json()) as { key: string };

    const head = await fetch(`${baseUrl}/objects/${key}`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("2048");
    expect(head.headers.get("x-oss-sha256")).toMatch(/^[0-9a-f]{64}$/);
    expect(head.headers.get("x-content-type-options")).toBe("nosniff");
    expect(head.headers.get("content-disposition")).toBe("attachment");
    expect((await head.arrayBuffer()).byteLength).toBe(0);

    const missing = await fetch(`${baseUrl}/objects/res-999`, { method: "HEAD" });
    expect(missing.status).toBe(404);
  });

  it("DELETE：204 后 GET 404；未知 key → 404", async () => {
    const postRes = await fetch(`${baseUrl}/objects`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: randomBytes(128),
    });
    const { key } = (await postRes.json()) as { key: string };

    const del = await fetch(`${baseUrl}/objects/${key}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect((await fetch(`${baseUrl}/objects/${key}`)).status).toBe(404);

    const delMissing = await fetch(`${baseUrl}/objects/res-999`, { method: "DELETE" });
    expect(delMissing.status).toBe(404);
  });

  it("GET /health → 200 + 全服务统一的 { status, timestamp } 形状", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; timestamp: string };
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
  });
});

describe("OSS HTTP 控制台只读面（/oss-object）", () => {
  async function putObject(bytes: Buffer, mime: string): Promise<string> {
    const res = await fetch(`${baseUrl}/objects`, {
      method: "POST",
      headers: { "content-type": mime },
      body: new Uint8Array(bytes),
    });
    const { key } = (await res.json()) as { key: string };
    return key;
  }

  it("GET /oss-object/query → 分页 JSON + 倒序 + ISO 时间", async () => {
    await putObject(Buffer.from("a"), "text/plain");
    const k2 = await putObject(Buffer.from("b"), "image/png");

    const res = await fetch(`${baseUrl}/oss-object/query?page=1&pageSize=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pagination: { page: number; pageSize: number; total: number };
      items: Array<{
        key: string;
        mime: string;
        size: number;
        refcount: number;
        createdAt: string;
      }>;
    };
    expect(body.pagination.total).toBe(2);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.key).toBe(k2); // 最新的先出
    expect(body.items[0]!.mime).toBe("image/png");
    expect(body.items[0]!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("GET /oss-object/query?mime= → 精确过滤", async () => {
    await putObject(Buffer.from("t"), "text/plain");
    await putObject(Buffer.from("i"), "image/png");

    const res = await fetch(`${baseUrl}/oss-object/query?mime=${encodeURIComponent("image/png")}`);
    const body = (await res.json()) as {
      pagination: { total: number };
      items: Array<{ mime: string }>;
    };
    expect(body.pagination.total).toBe(1);
    expect(body.items.every(item => item.mime === "image/png")).toBe(true);
  });

  it("GET /oss-object/stats → 去重口径", async () => {
    const dup = Buffer.from("dup-bytes");
    await putObject(dup, "text/plain");
    await putObject(dup, "text/plain");
    const uniq = randomBytes(100);
    await putObject(uniq, "application/octet-stream");

    const res = await fetch(`${baseUrl}/oss-object/stats`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      objectCount: number;
      blobCount: number;
      physicalBytes: number;
      logicalBytes: number;
      dedupSavedBytes: number;
    };
    expect(body.objectCount).toBe(3);
    expect(body.blobCount).toBe(2);
    expect(body.physicalBytes).toBe(dup.length + uniq.length);
    expect(body.logicalBytes).toBe(dup.length * 2 + uniq.length);
    expect(body.dedupSavedBytes).toBe(dup.length);
  });

  it("GET /oss-object/:key/content → 原字节 + nosniff + attachment（复用 getObject）", async () => {
    const bytes = randomBytes(256);
    const key = await putObject(bytes, "image/png");

    const res = await fetch(`${baseUrl}/oss-object/${key}/content`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toBe("attachment");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(bytes));

    const missing = await fetch(`${baseUrl}/oss-object/res-999/content`);
    expect(missing.status).toBe(404);
  });
});
