import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GameState } from "../engine/types.js";

// === 存档持久化 ===
//
// issue #234 B：写串行（避免交错）+ 原子写（tmp + rename）+ 损坏恢复（parse 失败改名备份、返回 null）。
// 单人单局：一个 save.json。状态形状与版本由 GameState 自己拥有，读回不认识就当作无存档。

const SAVE_FILE = "save.json";

export class SaveStore {
  private readonly dir: string;
  /** 串行写队列：把每次 save 挂到上一次之后，杜绝并发交错。 */
  private writeChain: Promise<void> = Promise.resolve();

  public constructor({ dir }: { dir: string }) {
    this.dir = dir;
  }

  public async load(): Promise<GameState | null> {
    const path = join(this.dir, SAVE_FILE);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return null; // 无存档。
    }
    try {
      return JSON.parse(raw) as GameState;
    } catch {
      // 损坏：改名备份，返回 null 让上层开新局，绝不因坏档卡死服务。
      const backup = join(this.dir, `save.corrupt-${Date.now()}.json`);
      await rename(path, backup).catch(() => undefined);
      return null;
    }
  }

  public save(state: GameState): Promise<void> {
    const path = join(this.dir, SAVE_FILE);
    const tmp = `${path}.tmp`;
    const payload = JSON.stringify(state);
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(tmp, payload, "utf8");
        await rename(tmp, path); // 原子替换。
      });
    return this.writeChain;
  }
}
