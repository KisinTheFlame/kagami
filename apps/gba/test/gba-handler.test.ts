import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GBA_MEMORY_DUMP_SIZE,
  GBA_MEMORY_EWRAM_SIZE,
  GBA_MEMORY_IWRAM_SIZE,
  GBA_MEMORY_LAYOUT,
  GBA_MEMORY_VRAM_SIZE,
} from "@kagami/gba-api/contract";
import { GbaService } from "../src/application/gba.service.js";
import { GbaHandler } from "../src/http/gba.handler.js";
import { FakeEmulatorCore, FakeOssClient, createMemoryStore, fakeRomBytes } from "./helpers.js";
import { initTestLoggerRuntime } from "./helpers/logger.js";

initTestLoggerRuntime();

/**
 * GbaHandler 的 HTTP 面测试（#599）：真 fastify 实例 + app.inject，服务层用 fake 内核 / 内存
 * store / 内存 OSS 驱动——不起真端口、不碰真库，仍覆盖到 binary-raw 路由的 hijack 出口。
 */
describe("GbaHandler 内存 dump 路由", () => {
  let app: FastifyInstance;
  let service: GbaService;
  let cores: FakeEmulatorCore[];

  beforeEach(() => {
    cores = [];
    service = new GbaService({
      store: createMemoryStore(),
      ossClient: new FakeOssClient(),
      coreFactory: () => {
        const core = new FakeEmulatorCore();
        cores.push(core);
        return core;
      },
    });
    app = Fastify();
    new GbaHandler({ service }).register(app);
  });

  afterEach(async () => {
    await service.shutdown();
    await app.close();
  });

  async function loadGame(): Promise<void> {
    const upload = await service.uploadRom({ name: "dump 路由", bytes: fakeRomBytes(41) });
    if (!upload.ok) {
      throw new Error(`upload 失败: ${upload.reason}`);
    }
    const load = await service.loadGame(upload.rom.id);
    if (!load.ok) {
      throw new Error(`load 失败: ${load.reason}`);
    }
  }

  it("已加载：200 + 固定长度 + 自描述头，三段按 EWRAM‖IWRAM‖VRAM 顺序拼接", async () => {
    await loadGame();
    const res = await app.inject({ method: "GET", url: "/gba/run/memory" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.headers["content-length"]).toBe(String(GBA_MEMORY_DUMP_SIZE));
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-gba-layout"]).toBe(GBA_MEMORY_LAYOUT);
    // 帧计数与 state 同源（冷启动推进一帧后为 1）。
    expect(res.headers["x-gba-frame"]).toBe(String(service.state().frame));

    const body = res.rawPayload;
    expect(body.length).toBe(GBA_MEMORY_DUMP_SIZE);
    // FakeEmulatorCore 各段填不同常量：边界字节即可判定拼接顺序没有错位。
    expect(body[0]).toBe(0xe0);
    expect(body[GBA_MEMORY_EWRAM_SIZE - 1]).toBe(0xe0);
    expect(body[GBA_MEMORY_EWRAM_SIZE]).toBe(0x11);
    expect(body[GBA_MEMORY_EWRAM_SIZE + GBA_MEMORY_IWRAM_SIZE - 1]).toBe(0x11);
    expect(body[GBA_MEMORY_EWRAM_SIZE + GBA_MEMORY_IWRAM_SIZE]).toBe(0x77);
    expect(body[GBA_MEMORY_DUMP_SIZE - 1]).toBe(0x77);
  });

  it("未加载 ROM：404 空体", async () => {
    const res = await app.inject({ method: "GET", url: "/gba/run/memory" });
    expect(res.statusCode).toBe(404);
    expect(res.rawPayload.length).toBe(0);
  });

  it("核心拿不出一致快照（不支持 savestate / 布局校验失败）：404 空体，不返回半截字节", async () => {
    await loadGame();
    cores[cores.length - 1]!.failReadMemory = true;
    const res = await app.inject({ method: "GET", url: "/gba/run/memory" });
    expect(res.statusCode).toBe(404);
    expect(res.rawPayload.length).toBe(0);
  });

  it("布局常量自洽：三段长度之和 == dump 总长，layout 串描述的偏移不重叠不留洞", () => {
    expect(GBA_MEMORY_EWRAM_SIZE + GBA_MEMORY_IWRAM_SIZE + GBA_MEMORY_VRAM_SIZE).toBe(
      GBA_MEMORY_DUMP_SIZE,
    );
    const segments = GBA_MEMORY_LAYOUT.split(",").map(entry => {
      const [, offset, length] = /\+(\d+):(\d+)$/.exec(entry) ?? [];
      return { offset: Number(offset), length: Number(length) };
    });
    let cursor = 0;
    for (const segment of segments) {
      expect(segment.offset).toBe(cursor);
      cursor += segment.length;
    }
    expect(cursor).toBe(GBA_MEMORY_DUMP_SIZE);
  });
});
