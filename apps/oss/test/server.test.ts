import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOssServer } from "../src/http/server.js";
import { ObjectStore } from "../src/store/object-store.js";

const MAX_BODY_BYTES = 64 * 1024; // 测试用小上限，机制与生产 50MB 完全一致。

let blobDir: string;
let db: Database.Database;
let store: ObjectStore;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  blobDir = await mkdtemp(path.join(tmpdir(), "oss-http-"));
  db = new Database(":memory:");
  store = new ObjectStore({ db, blobDir });
  server = createOssServer(store, MAX_BODY_BYTES);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
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
});
