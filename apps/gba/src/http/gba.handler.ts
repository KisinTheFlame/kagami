import type { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import {
  registerBinaryEnvelopeRoute,
  registerBinaryRawRoute,
  registerJsonRoute,
} from "@kagami/http/register";
import {
  GBA_MEMORY_DUMP_SIZE,
  GBA_MEMORY_FRAME_HEADER,
  GBA_MEMORY_LAYOUT,
  GBA_MEMORY_LAYOUT_HEADER,
  gbaApiContract,
  gbaConsoleContract,
  gbaMemoryContract,
  gbaRomsContract,
} from "@kagami/gba-api/contract";
import type { GbaService } from "../application/gba.service.js";
import { MAX_ROM_BYTES, toRomView } from "../application/rom-library.js";

/**
 * kagami-gba 的 HTTP 面：游玩路由与内存 dump（agent 直连）+ ROM 管理路由（控制台经 gateway
 * `/gba/roms`）+ 控制台实况面。全量走 @kagami/gba-api 契约。上传是 binary-envelope（裸字节 +
 * header 带 encodeURIComponent 过的 ROM 名）；JSON 与二进制路由共存于同一实例——不用全局
 * useRawBodyPassthrough（会弄坏 JSON 路由），只给 application/octet-stream 注册透传 parser
 * （见 runtime configure）。
 */
export class GbaHandler {
  private readonly service: GbaService;

  public constructor({ service }: { service: GbaService }) {
    this.service = service;
  }

  public register(app: FastifyInstance): void {
    // === 游玩面（agent 直连，不过 gateway）===

    registerJsonRoute(app, gbaApiContract.state, () => this.service.state());

    registerJsonRoute(app, gbaApiContract.setForeground, ({ input }) =>
      this.service.setForeground(input.focused),
    );

    registerJsonRoute(app, gbaApiContract.loadGame, async ({ input }) =>
      this.service.loadGame(input.romId),
    );

    registerJsonRoute(app, gbaApiContract.press, async ({ input }) => this.service.press(input));

    registerJsonRoute(app, gbaApiContract.pressSequence, async ({ input }) =>
      this.service.pressSequence(input),
    );

    registerJsonRoute(app, gbaApiContract.screenshot, () => this.service.screenshot());

    // === ROM 管理面（listRoms 与 agent 共用同一条路由）===

    registerJsonRoute(app, gbaApiContract.listRoms, async () => ({
      roms: (await this.service.listRoms()).map(toRomView),
    }));

    registerBinaryEnvelopeRoute(
      app,
      gbaRomsContract.uploadRom,
      async ({ headers, body, request }) => {
        if (!body) {
          throw new Error("[gba] uploadRom 缺少上行字节流（bytesIn 路由不应至此）");
        }
        let name: string;
        try {
          name = decodeURIComponent(headers["x-gba-rom-name"]);
        } catch {
          return { ok: false as const, reason: "INVALID_NAME" };
        }
        // content-length 早拒（透传 parser 不吃 fastify bodyLimit）；chunked/谎报由 readAllWithCap 兜底。
        const declared = Number(request.headers["content-length"]);
        if (Number.isFinite(declared) && declared > MAX_ROM_BYTES) {
          return { ok: false as const, reason: "INVALID_ROM_SIZE" };
        }
        const bytes = await readAllWithCap(body, MAX_ROM_BYTES);
        if (bytes === null) {
          return { ok: false as const, reason: "INVALID_ROM_SIZE" };
        }
        return this.service.uploadRom({ name, bytes });
      },
    );

    registerJsonRoute(app, gbaRomsContract.deleteRom, async ({ input }) =>
      this.service.deleteRom(input.romId),
    );

    registerJsonRoute(app, gbaApiContract.importRom, async ({ input }) =>
      this.service.importRomFromOss(input),
    );

    // === 内存 dump 面（#599,被动只读:不刷新看门狗）===

    registerBinaryRawRoute(app, gbaMemoryContract.dump, async ({ raw }) => {
      const dump = this.service.dumpMemory();
      if (!dump) {
        // 未加载 ROM / 核心拿不出一致快照——一律空体 404，绝不返回错位或半截字节。
        raw.writeHead(404).end();
        return;
      }
      const { memory, frame } = dump;
      const body = Buffer.concat([memory.ewram, memory.iwram, memory.vram], GBA_MEMORY_DUMP_SIZE);
      raw.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(body.length),
        // 内存每帧都在变,禁止任何缓存层介入(同实况帧)。
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        [GBA_MEMORY_FRAME_HEADER]: String(frame),
        [GBA_MEMORY_LAYOUT_HEADER]: GBA_MEMORY_LAYOUT,
      });
      raw.end(body);
    });

    // === 控制台实况面（#541 PR3,被动只读:不刷新看门狗）===

    registerJsonRoute(app, gbaConsoleContract.state, () => this.service.state());

    registerBinaryRawRoute(app, gbaConsoleContract.screen, async ({ raw }) => {
      const png = this.service.peekFramePng();
      if (!png) {
        raw.writeHead(404).end();
        return;
      }
      raw.writeHead(200, {
        "content-type": "image/png",
        "content-length": String(png.length),
        // 实况帧每秒都在变,禁止任何缓存层介入。
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      raw.end(png);
    });
  }
}

/** 把上行流读满进内存（ROM ≤40MB，需要完整字节算 sha256 / 交 OSS）；超上限返回 null。 */
async function readAllWithCap(source: Readable, maxBytes: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > maxBytes) {
      return null;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
