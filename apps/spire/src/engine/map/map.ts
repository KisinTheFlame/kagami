import type { MapGraph, MapNode, MapNodeType, RngState } from "../types.js";
import { nextFloat, nextInt } from "../rng.js";

// === 分支地图（StS 式节点图）===
//
// 一幕 = ROWS 层常规节点 + 顶上一个 Boss 节点。从底层若干入口向上走，节点间连边形成 DAG，
// 玩家每次从当前节点的出边里选一条往上爬。节点类型按 StS 规则分配（底层全战斗、第 9 层宝箱、
// Boss 前一层全休息）。功能性规则，非版权表达。
//
// 节点类型的**内容**随里程碑逐步启用：本模块用 enabledTypes 控制生成器会放哪些类型，
// 精英/事件/商店在其内容里程碑加入（M2/M4）。当前启用：combat / treasure / rest（+强制 boss）。

const ROWS = 15;
const COLS = 7;
const PATHS = 6;
const TREASURE_ROW = 8; // 第 9 层固定宝箱
const REST_ROW = ROWS - 1; // Boss 前一层固定休息

function nodeId(row: number, col: number): string {
  return `${row}-${col}`;
}

/** 沿列做一次向上随机游走：每层从 {col-1,col,col+1} 里选一个夹紧到 [0,COLS-1]。 */
function walkColumn(rng: RngState, col: number): number {
  const delta = nextInt(rng, 3) - 1; // -1 / 0 / +1
  return Math.max(0, Math.min(COLS - 1, col + delta));
}

/**
 * 生成一张幕地图。enabledTypes 决定“非强制”行可分配的普通节点类型（强制行不受它影响）。
 * 默认启用 combat / rest / treasure（treasure 只出现在强制宝箱行）。
 */
export function generateMap(
  rng: RngState,
  enabledTypes: readonly MapNodeType[] = ["combat", "rest"],
): MapGraph {
  const nodes: Record<string, MapNode> = {};
  const ensure = (row: number, col: number): MapNode => {
    const id = nodeId(row, col);
    const existing = nodes[id];
    if (existing) {
      return existing;
    }
    const created: MapNode = { id, row, col, type: "combat", next: [] };
    nodes[id] = created;
    return created;
  };
  const link = (from: MapNode, to: MapNode): void => {
    if (!from.next.includes(to.id)) {
      from.next.push(to.id);
    }
  };

  // 碰路：PATHS 条从底层随机列向上的游走，落到的节点即“存在”，相邻层连边。
  for (let p = 0; p < PATHS; p += 1) {
    let col = nextInt(rng, COLS);
    let current = ensure(0, col);
    for (let row = 1; row < ROWS; row += 1) {
      const nextCol = walkColumn(rng, col);
      const upper = ensure(row, nextCol);
      link(current, upper);
      current = upper;
      col = nextCol;
    }
  }

  // 顶层节点全部连到唯一 Boss 节点。
  const bossNode: MapNode = { id: "boss", row: ROWS, col: 3, type: "boss", next: [] };
  nodes[bossNode.id] = bossNode;
  for (const node of Object.values(nodes)) {
    if (node.row === ROWS - 1) {
      link(node, bossNode);
    }
  }

  assignTypes(rng, nodes, enabledTypes);

  const startNodeIds = Object.values(nodes)
    .filter(node => node.row === 0)
    .sort((a, b) => a.col - b.col)
    .map(node => node.id);

  return { nodes, rows: ROWS, startNodeIds, bossNodeId: bossNode.id };
}

function assignTypes(
  rng: RngState,
  nodes: Record<string, MapNode>,
  enabledTypes: readonly MapNodeType[],
): void {
  const restEnabled = enabledTypes.includes("rest");
  const eliteEnabled = enabledTypes.includes("elite");
  const eventEnabled = enabledTypes.includes("event");
  const shopEnabled = enabledTypes.includes("shop");
  const treasureEnabled = enabledTypes.includes("treasure");

  for (const node of Object.values(nodes)) {
    if (node.type === "boss") {
      continue;
    }
    // 强制行。
    if (node.row === 0) {
      node.type = "combat";
      continue;
    }
    if (treasureEnabled && node.row === TREASURE_ROW) {
      node.type = "treasure";
      continue;
    }
    if (restEnabled && node.row === REST_ROW) {
      node.type = "rest";
      continue;
    }
    // 其余行：按启用类型加权。早层不出精英/休息；末几层不出精英。
    node.type = pickRegularType(rng, node.row, {
      restEnabled,
      eliteEnabled,
      eventEnabled,
      shopEnabled,
    });
  }
}

function pickRegularType(
  rng: RngState,
  row: number,
  flags: {
    restEnabled: boolean;
    eliteEnabled: boolean;
    eventEnabled: boolean;
    shopEnabled: boolean;
  },
): MapNodeType {
  const weighted: { type: MapNodeType; weight: number }[] = [{ type: "combat", weight: 100 }];
  if (flags.eventEnabled) {
    weighted.push({ type: "event", weight: 22 });
  }
  if (flags.shopEnabled && row >= 3) {
    weighted.push({ type: "shop", weight: 8 });
  }
  if (flags.eliteEnabled && row >= 4 && row < REST_ROW - 1) {
    weighted.push({ type: "elite", weight: 16 });
  }
  if (flags.restEnabled && row >= 5 && row < REST_ROW - 1) {
    weighted.push({ type: "rest", weight: 12 });
  }
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = nextFloat(rng) * total;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll < 0) {
      return entry.type;
    }
  }
  return "combat";
}

/** 当前所在节点的可选下一节点 id（currentNodeId 为 null 时返回底层入口）。 */
export function availableNext(graph: MapGraph, currentNodeId: string | null): string[] {
  if (currentNodeId === null) {
    return graph.startNodeIds;
  }
  return graph.nodes[currentNodeId]?.next ?? [];
}
