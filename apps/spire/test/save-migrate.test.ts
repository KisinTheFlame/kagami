import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SpireScreenSchema } from "@kagami/spire-api/contract";
import { newRun } from "../src/engine/engine.js";
import { startCombat } from "../src/engine/combat/combat.js";
import { toScreenView } from "../src/application/state-view.js";
import { SaveStore } from "../src/persistence/save-store.js";
import { migrateLoadedState } from "../src/persistence/migrate.js";

// 回归（小镜「开新局报错 orbs/stance required」）：老版本存档缺 C3/C4 后加字段
// （orbs/orbSlots/playerStance），新二进制读回后序列化会被 registerJsonRoute 的
// output.parse 拒（缺字段 500）。迁移在读盘时回填默认值，让老对局能继续。

/** 造一个「老版本存档」：战斗态但删掉 C3/C4 后加字段（模拟旧二进制存的档）。 */
function makeLegacySaveJson(): string {
  const state = newRun({ runId: "legacy", seed: 1, character: "watcher" });
  state.version = 1;
  startCombat(state, "cultist");
  const loose = state as unknown as Record<string, unknown>;
  const combat = loose["combat"] as Record<string, unknown>;
  // 旧档没有这些字段。
  delete combat["orbs"];
  delete combat["orbSlots"];
  delete combat["playerStance"];
  for (const enemy of combat["enemies"] as Record<string, unknown>[]) {
    delete enemy["hasRevived"];
  }
  return JSON.stringify(state);
}

describe("存档迁移：老档缺后加字段", () => {
  it("未迁移的老档序列化会被契约 schema 拒（复现 bug）", () => {
    const legacy = JSON.parse(makeLegacySaveJson()) as ReturnType<typeof newRun>;
    // 直接喂 toScreenView：缺 orbs/stance → SpireScreenSchema.parse 抛（服务端 500 的根因）。
    expect(() => SpireScreenSchema.parse(toScreenView(legacy, {}))).toThrow();
  });

  it("migrateLoadedState 回填后序列化通过契约 schema", () => {
    const migrated = migrateLoadedState(JSON.parse(makeLegacySaveJson()));
    expect(migrated.combat!.orbs).toEqual([]);
    expect(migrated.combat!.playerStance).toBe("none");
    // watcher 非机器人 → 0 个球槽。
    expect(migrated.combat!.orbSlots).toBe(0);
    expect(() => SpireScreenSchema.parse(toScreenView(migrated, {}))).not.toThrow();
  });

  it("SaveStore.load 读老档时自动迁移", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "spire-migrate-"));
    await writeFile(path.join(dir, "save.json"), makeLegacySaveJson(), "utf8");
    const loaded = await new SaveStore({ dir }).load();
    expect(loaded).not.toBeNull();
    expect(() => SpireScreenSchema.parse(toScreenView(loaded!, {}))).not.toThrow();
  });

  it("机器人老档回填 3 个球槽", () => {
    const state = newRun({ runId: "legacy-defect", seed: 1, character: "defect" });
    state.version = 1;
    startCombat(state, "cultist");
    const loose = state as unknown as Record<string, unknown>;
    const combat = loose["combat"] as Record<string, unknown>;
    delete combat["orbs"];
    delete combat["orbSlots"];
    delete combat["playerStance"];
    const migrated = migrateLoadedState(JSON.parse(JSON.stringify(state)));
    expect(migrated.combat!.orbSlots).toBe(3);
  });

  it("不覆盖已有字段（新档 orbs 有内容时不清空）", () => {
    const state = newRun({ runId: "fresh-defect", seed: 1, character: "defect" });
    state.version = 1;
    startCombat(state, "cultist");
    state.combat!.orbs = [{ type: "lightning" }];
    const migrated = migrateLoadedState(JSON.parse(JSON.stringify(state)));
    expect(migrated.combat!.orbs).toEqual([{ type: "lightning" }]);
  });
});
