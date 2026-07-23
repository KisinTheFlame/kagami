import { describe, expect, it } from "vitest";
import { createMemoryStore } from "./helpers.js";

describe("GbaStore", () => {
  it("rom 增查删 + hasSave 联动", () => {
    const store = createMemoryStore();
    const rom = store.insertRom({
      name: "口袋妖怪",
      ossKey: "res-1",
      sizeBytes: 512,
      sha256: "a1",
    });
    expect(rom.hasSave).toBe(false);

    store.saveBatterySave(rom.id, Buffer.from("save"));
    expect(store.getRom(rom.id)?.hasSave).toBe(true);
    expect(store.listRoms()).toHaveLength(1);
    expect(store.findRomBySha256("a1")?.id).toBe(rom.id);
    expect(store.findRomByName("口袋妖怪")?.id).toBe(rom.id);

    // 删除级联清 battery_save
    expect(store.deleteRom(rom.id)).toBe(true);
    expect(store.getBatterySave(rom.id)).toBeNull();
    expect(store.listRoms()).toHaveLength(0);
  });

  it("run_state 单行 upsert；删 ROM 后置 NULL", () => {
    const store = createMemoryStore();
    const rom = store.insertRom({ name: "g", ossKey: "res-1", sizeBytes: 512, sha256: "b2" });
    expect(store.getLastRomId()).toBeNull();
    store.setLastRomId(rom.id);
    expect(store.getLastRomId()).toBe(rom.id);
    store.deleteRom(rom.id);
    expect(store.getLastRomId()).toBeNull(); // ON DELETE SET NULL
  });

  it("resume_state 单行 upsert 往返；消费即删；删 ROM 级联清快照", () => {
    const store = createMemoryStore();
    const rom = store.insertRom({ name: "g", ossKey: "res-1", sizeBytes: 512, sha256: "d4" });
    expect(store.getResumeState()).toBeNull();

    store.saveResumeState({
      romId: rom.id,
      savestate: Buffer.from("state-v1"),
      foreground: true,
      frame: 42,
    });
    store.saveResumeState({
      romId: rom.id,
      savestate: Buffer.from("state-v2"),
      foreground: false,
      frame: 100,
    });
    const resume = store.getResumeState();
    expect(resume).toEqual({
      romId: rom.id,
      savestate: Buffer.from("state-v2"),
      foreground: false,
      frame: 100,
    });

    store.clearResumeState();
    expect(store.getResumeState()).toBeNull();

    // ON DELETE CASCADE：删 ROM 连带清快照
    store.saveResumeState({
      romId: rom.id,
      savestate: Buffer.from("s"),
      foreground: true,
      frame: 1,
    });
    store.deleteRom(rom.id);
    expect(store.getResumeState()).toBeNull();
  });

  it("battery_save upsert 覆盖旧档", () => {
    const store = createMemoryStore();
    const rom = store.insertRom({ name: "g", ossKey: "res-1", sizeBytes: 512, sha256: "c3" });
    store.saveBatterySave(rom.id, Buffer.from("v1"));
    store.saveBatterySave(rom.id, Buffer.from("v2-longer"));
    expect(store.getBatterySave(rom.id)?.toString()).toBe("v2-longer");
  });
});
