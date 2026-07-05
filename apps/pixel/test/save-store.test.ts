import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SaveStore } from "../src/persistence/save-store.js";
import type { CanvasSnapshot } from "../src/domain/canvas.js";

const SNAPSHOT: CanvasSnapshot = { width: 3, height: 2, cells: ["r..", "..k"] };

const dirs: string[] = [];

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pixel-save-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  dirs.length = 0;
});

describe("SaveStore", () => {
  it("无存档时 load 返回 null", async () => {
    const store = new SaveStore({ dir: await freshDir() });
    expect(await store.load()).toBeNull();
  });

  it("save → load 往返逐格相等", async () => {
    const store = new SaveStore({ dir: await freshDir() });
    await store.save(SNAPSHOT);
    expect(await store.load()).toEqual(SNAPSHOT);
  });

  it("坏档 → load 返回 null 且改名备份", async () => {
    const dir = await freshDir();
    await writeFile(join(dir, "canvas.json"), "{ not valid json", "utf8");
    const store = new SaveStore({ dir });
    expect(await store.load()).toBeNull();
    const files = await readdir(dir);
    expect(files.some(f => f.startsWith("canvas.corrupt-"))).toBe(true);
  });

  it("超界/畸形但版本对的存档 → 当坏档改名备份、返回 null", async () => {
    const dir = await freshDir();
    await writeFile(
      join(dir, "canvas.json"),
      JSON.stringify({ version: 1, canvas: { width: 100, height: 100, cells: ["x"] } }),
      "utf8",
    );
    const store = new SaveStore({ dir });
    expect(await store.load()).toBeNull();
    const files = await readdir(dir);
    expect(files.some(f => f.startsWith("canvas.corrupt-"))).toBe(true);
  });

  it("版本不认 → load 返回 null", async () => {
    const dir = await freshDir();
    await writeFile(
      join(dir, "canvas.json"),
      JSON.stringify({ version: 99, canvas: SNAPSHOT }),
      "utf8",
    );
    const store = new SaveStore({ dir });
    expect(await store.load()).toBeNull();
  });

  it("flush 排空写队列不抛", async () => {
    const store = new SaveStore({ dir: await freshDir() });
    void store.save(SNAPSHOT);
    await expect(store.flush()).resolves.toBeUndefined();
  });
});
