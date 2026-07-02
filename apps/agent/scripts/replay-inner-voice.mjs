// 摸鱼判定 14 天回放校准（issue #265 验收判据 2）。
//
// 用法：
//   1. 先 `pnpm --filter @kagami/agent build`（脚本从 dist 导入判定纯函数，保证与生产同源）
//   2. 从生产库 dump 素材（只读模式）：
//      sqlite3 -json "file:<仓库根>/data/sqlite/kagami.db?mode=ro" \
//        "SELECT created_at, json(message) AS message FROM ledger \
//         WHERE runtime_key='root-agent' AND created_at > datetime('now','-14 days') \
//           AND json_extract(message,'$.role')='assistant' ORDER BY id ASC" > /tmp/ledger-14d.json
//   3. node apps/agent/scripts/replay-inner-voice.mjs /tmp/ledger-14d.json
//
// 语义：按时间序走 assistant 消息，把 toolCalls 分类喂进信号数组；每条消息后以其
// created_at 为 now 做一次判定，命中即记一次注入尝试（模拟「触发必消耗配额」）。
// 输出每个北京自然日的触发次数分布，用于把常量校准到日均 1~2 次的目标带。
import { readFileSync } from "node:fs";
import {
  classifyRootToolCall,
  evaluateIdleTrigger,
  getBeijingClock,
  INNER_VOICE_IDLE_POLICY,
} from "../dist/agent/capabilities/inner-voice/domain/idle-detector.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("用法: node replay-inner-voice.mjs <ledger-14d.json> [windowMs] [minWaitCount]");
  process.exit(1);
}

const policy = {
  ...INNER_VOICE_IDLE_POLICY,
  ...(process.argv[3] ? { windowMs: Number(process.argv[3]) } : {}),
  ...(process.argv[4] ? { minWaitCount: Number(process.argv[4]) } : {}),
};

const rows = JSON.parse(readFileSync(inputPath, "utf8"));
const waitAt = [];
const engagedAt = [];
const attemptAt = [];
const triggersByDay = new Map();
const triggerMoments = [];

for (const row of rows) {
  const createdAt = new Date(row.created_at);
  const message = JSON.parse(row.message);
  for (const toolCall of message.toolCalls ?? []) {
    const kind = classifyRootToolCall({
      name: toolCall.name,
      argumentsValue: toolCall.arguments ?? {},
    });
    if (kind === "wait") {
      waitAt.push(createdAt);
    } else if (kind === "engaged") {
      engagedAt.push(createdAt);
    }
  }

  if (evaluateIdleTrigger({ now: createdAt, signals: { waitAt, engagedAt, attemptAt }, policy })) {
    attemptAt.push(createdAt);
    const { dayKey, hour } = getBeijingClock(createdAt);
    triggersByDay.set(dayKey, (triggersByDay.get(dayKey) ?? 0) + 1);
    triggerMoments.push(`${dayKey} ${String(hour).padStart(2, "0")} 时`);
  }
}

const days = [...triggersByDay.keys()].sort();
const total = [...triggersByDay.values()].reduce((sum, n) => sum + n, 0);
const firstAt = rows.length > 0 ? new Date(rows[0].created_at) : null;
const lastAt = rows.length > 0 ? new Date(rows.at(-1).created_at) : null;
const spanDays =
  firstAt && lastAt ? Math.max(1, (lastAt.getTime() - firstAt.getTime()) / 86_400_000) : 0;

console.log(`政策: windowMs=${policy.windowMs} minWaitCount=${policy.minWaitCount}`);
console.log(`素材: ${rows.length} 条 assistant 消息，跨 ${spanDays.toFixed(1)} 天`);
console.log(`触发总数: ${total}，日均 ${(total / spanDays).toFixed(2)} 次`);
console.log("按北京自然日分布:");
for (const day of days) {
  console.log(`  ${day}: ${triggersByDay.get(day)} 次`);
}
console.log("触发时刻:");
for (const moment of triggerMoments) {
  console.log(`  ${moment}`);
}
