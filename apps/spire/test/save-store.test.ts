import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SaveStore } from "../src/persistence/save-store.js";
import type { GameState } from "../src/engine/types.js";

// SaveStore 只 JSON.stringify，不读字段：用最小对象顶 GameState 位即可。
const fakeState = (version: number): GameState => ({ version }) as unknown as GameState;

describe("SaveStore.flush（关停排空钩子，issue #274）", () => {
  it("flush 等到在途写全部落盘，文件内容是最后一次 save", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "spire-save-"));
    const store = new SaveStore({ dir });

    void store.save(fakeState(1));
    void store.save(fakeState(2));
    await store.flush();

    const raw = await readFile(path.join(dir, "save.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ version: 2 });
  });

  it("在途写失败时 flush 仍 resolve，不阻断关停", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "spire-save-"));
    // 用一个普通文件挡住目录路径：mkdir 将以 ENOTDIR 失败，写链 reject。
    const blocker = path.join(dir, "not-a-dir");
    await writeFile(blocker, "x", "utf8");
    const store = new SaveStore({ dir: path.join(blocker, "sub") });

    await expect(store.save(fakeState(1))).rejects.toThrow();
    await expect(store.flush()).resolves.toBeUndefined();
  });
});
