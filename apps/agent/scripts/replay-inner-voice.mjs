// 摸鱼判定回放（issue #265）：拿真实 ledger 估算当前常量下的实际触发频率。
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
// 语义：按时间序走 assistant 消息，把 wait 调用喂进信号数组；每条消息后以其 created_at
// 为 now 做一次判定，命中即记一次注入尝试（模拟「触发必消耗配额」）。输出每个北京自然日
// 的触发次数分布。
import { readFileSync } from "node:fs";
import {
  evaluateIdleTrigger,
  getBeijingHour,
  INNER_VOICE_IDLE_POLICY,
  isWaitToolCall,
} from "../dist/agent/capabilities/inner-voice/domain/idle-detector.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("用法: node replay-inner-voice.mjs <ledger-14d.json>");
  process.exit(1);
}

const policy = INNER_VOICE_IDLE_POLICY;

function beijingDayKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const v = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

const rows = JSON.parse(readFileSync(inputPath, "utf8"));
const waitAt = [];
const attemptAt = [];
const triggersByDay = new Map();
const triggerMoments = [];

for (const row of rows) {
  const createdAt = new Date(row.created_at);
  const message = JSON.parse(row.message);
  for (const toolCall of message.toolCalls ?? []) {
    if (isWaitToolCall(toolCall.name)) {
      waitAt.push(createdAt);
    }
  }

  if (evaluateIdleTrigger({ now: createdAt, signals: { waitAt, attemptAt }, policy })) {
    attemptAt.push(createdAt);
    const dayKey = beijingDayKey(createdAt);
    triggersByDay.set(dayKey, (triggersByDay.get(dayKey) ?? 0) + 1);
    triggerMoments.push(`${dayKey} ${String(getBeijingHour(createdAt)).padStart(2, "0")} 时`);
  }
}

const days = [...triggersByDay.keys()].sort();
const total = [...triggersByDay.values()].reduce((sum, n) => sum + n, 0);
const firstAt = rows.length > 0 ? new Date(rows[0].created_at) : null;
const lastAt = rows.length > 0 ? new Date(rows.at(-1).created_at) : null;
const spanDays =
  firstAt && lastAt ? Math.max(1, (lastAt.getTime() - firstAt.getTime()) / 86_400_000) : 0;

console.log(
  `政策: windowMs=${policy.windowMs} minWaitCount=${policy.minWaitCount} ` +
    `cooldownMs=${policy.attemptCooldownMs} 静默窗=[${policy.quietStartHour},${policy.quietEndHour})`,
);
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
