import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MAX_CANVAS_SIZE } from "@kagami/pixel-api/contract";
import type { CanvasSnapshot } from "../domain/canvas.js";

// === 画布持久化（issue #365）===
//
// 镜像 spire SaveStore：写串行（避免连续绘图交错）+ 原子写（tmp + rename）+ 损坏恢复（parse
// 失败 / 版本不认 → 改名备份、返回 null）+ 关停 flush（SIGTERM 撞在途写盘不丢档）。
// 单块「当前画布」：一个 canvas.json。带 version，将来改 palette / cell 表示能平滑迁移。

const SAVE_FILE = "canvas.json";
const CURRENT_VERSION = 1;

type PersistedCanvas = {
  version: number;
  canvas: CanvasSnapshot;
};

// 全量校验（尺寸上限 + 行数/行长与 width/height 自洽），让任何畸形/超界存档在 load 层就被
// 当坏档改名备份、返回 null，而不是漏到 fromSnapshot 里抛错（那样不留 .corrupt 备份、静默丢档）。
function isSnapshot(value: unknown): value is CanvasSnapshot {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const snapshot = value as Record<string, unknown>;
  const { width, height, cells } = snapshot;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return false;
  }
  const w = width as number;
  const h = height as number;
  if (w < 1 || w > MAX_CANVAS_SIZE || h < 1 || h > MAX_CANVAS_SIZE) {
    return false;
  }
  if (!Array.isArray(cells) || cells.length !== h) {
    return false;
  }
  return cells.every(row => typeof row === "string" && row.length === w);
}

export class SaveStore {
  private readonly dir: string;
  /** 串行写队列：把每次 save 挂到上一次之后，杜绝并发交错。 */
  private writeChain: Promise<void> = Promise.resolve();

  public constructor({ dir }: { dir: string }) {
    this.dir = dir;
  }

  public async load(): Promise<CanvasSnapshot | null> {
    const path = join(this.dir, SAVE_FILE);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return null; // 无存档。
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        (parsed as PersistedCanvas).version !== CURRENT_VERSION ||
        !isSnapshot((parsed as PersistedCanvas).canvas)
      ) {
        throw new Error("bad snapshot shape or version");
      }
      return (parsed as PersistedCanvas).canvas;
    } catch {
      // 损坏 / 版本不认：改名备份、返回 null（当无画布起手），绝不因坏档卡死服务。
      const backup = join(this.dir, `canvas.corrupt-${Date.now()}.json`);
      await rename(path, backup).catch(() => undefined);
      return null;
    }
  }

  public save(snapshot: CanvasSnapshot): Promise<void> {
    const path = join(this.dir, SAVE_FILE);
    const tmp = `${path}.tmp`;
    const payload = JSON.stringify({ version: CURRENT_VERSION, canvas: snapshot });
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(tmp, payload, "utf8");
        await rename(tmp, path); // 原子替换。
      });
    return this.writeChain;
  }

  /** 等待写队列排空。关停时调用，避免 SIGTERM 撞上在途写盘丢档（写失败不阻断退出）。 */
  public flush(): Promise<void> {
    return this.writeChain.catch(() => undefined);
  }
}
