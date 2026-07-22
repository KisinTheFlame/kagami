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

  it("battery_save upsert 覆盖旧档", () => {
    const store = createMemoryStore();
    const rom = store.insertRom({ name: "g", ossKey: "res-1", sizeBytes: 512, sha256: "c3" });
    store.saveBatterySave(rom.id, Buffer.from("v1"));
    store.saveBatterySave(rom.id, Buffer.from("v2-longer"));
    expect(store.getBatterySave(rom.id)?.toString()).toBe("v2-longer");
  });
});
