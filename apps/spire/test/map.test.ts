import { describe, expect, it } from "vitest";
import { generateMap, availableNext } from "../src/engine/map/map.js";
import { seedRng } from "../src/engine/rng.js";
import type { MapGraph } from "../src/engine/types.js";

function bossReachable(graph: MapGraph): boolean {
  // 从任一入口 BFS 沿 next，能否到达 boss。
  const seen = new Set<string>(graph.startNodeIds);
  const queue = [...graph.startNodeIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === graph.bossNodeId) {
      return true;
    }
    for (const next of graph.nodes[id]?.next ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

describe("分支地图生成", () => {
  it("结构不变量：15 层、底层入口全战斗、Boss 节点存在且可达", () => {
    for (const seed of [1, 2, 7, 42, 100]) {
      const graph = generateMap(seedRng(seed), ["combat", "rest", "treasure"]);
      expect(graph.rows).toBe(15);
      expect(graph.startNodeIds.length).toBeGreaterThan(0);
      for (const id of graph.startNodeIds) {
        expect(graph.nodes[id]!.type).toBe("combat");
        expect(graph.nodes[id]!.row).toBe(0);
      }
      expect(graph.nodes[graph.bossNodeId]!.type).toBe("boss");
      expect(bossReachable(graph)).toBe(true);
    }
  });

  it("宝箱只出现在第 9 层（row 8）", () => {
    const graph = generateMap(seedRng(3), ["combat", "rest", "treasure"]);
    for (const node of Object.values(graph.nodes)) {
      if (node.type === "treasure") {
        expect(node.row).toBe(8);
      }
    }
  });

  it("未启用的类型不会出现（本里程碑无精英/事件/商店）", () => {
    const graph = generateMap(seedRng(9), ["combat", "rest", "treasure"]);
    for (const node of Object.values(graph.nodes)) {
      expect(["combat", "rest", "treasure", "boss"]).toContain(node.type);
    }
  });

  it("availableNext：null 返回入口、boss 返回空", () => {
    const graph = generateMap(seedRng(5), ["combat", "rest", "treasure"]);
    expect(availableNext(graph, null)).toEqual(graph.startNodeIds);
    expect(availableNext(graph, graph.bossNodeId)).toEqual([]);
  });

  it("同种子生成同地图（确定性）", () => {
    const a = generateMap(seedRng(77), ["combat", "rest", "treasure"]);
    const b = generateMap(seedRng(77), ["combat", "rest", "treasure"]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
