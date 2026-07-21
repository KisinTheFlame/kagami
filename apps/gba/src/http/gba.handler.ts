import type { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { registerBinaryEnvelopeRoute, registerJsonRoute } from "@kagami/http/register";
import { gbaApiContract, gbaRomsContract } from "@kagami/gba-api/contract";
import { MAX_ROM_BYTES, toRomView, type GbaService } from "../application/gba.service.js";

/**
 * kagami-gba 的 HTTP 面：游玩路由（agent 直连）+ ROM 管理路由（控制台经 gateway `/gba/roms`）。
 * 全量走 @kagami/gba-api 契约。上传是 binary-envelope（裸字节 + header 带 encodeURIComponent
 * 过的 ROM 名）；JSON 与二进制路由共存于同一实例——不用全局 useRawBodyPassthrough（会弄坏
 * JSON 路由），只给 application/octet-stream 注册透传 parser（见 runtime configure）。
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

    registerJsonRoute(app, gbaApiContract.listRoms, () => ({
      roms: this.service.listRoms().map(toRomView),
    }));

    registerBinaryEnvelopeRoute(app, gbaRomsContract.uploadRom, async ({ headers, body }) => {
      if (!body) {
        throw new Error("[gba] uploadRom 缺少上行字节流（bytesIn 路由不应至此）");
      }
      let name: string;
      try {
        name = decodeURIComponent(headers["x-gba-rom-name"]);
      } catch {
        return { ok: false as const, reason: "INVALID_NAME" };
      }
      const bytes = await readAllWithCap(body, MAX_ROM_BYTES);
      if (bytes === null) {
        return { ok: false as const, reason: "INVALID_ROM_SIZE" };
      }
      return this.service.uploadRom({ name, bytes });
    });

    registerJsonRoute(app, gbaRomsContract.deleteRom, async ({ input }) =>
      this.service.deleteRom(input.romId),
    );
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
