import { type TodoItemStatus } from "@kagami/console-api/todo";

export const TODO_STATUSES: TodoItemStatus[] = ["pending", "completed", "removed"];

export function toStatusLabel(status: TodoItemStatus): string {
  switch (status) {
    case "pending":
      return "进行中";
    case "completed":
      return "已完成";
    case "removed":
      return "已删除";
  }
}

/** 状态涂色遵循 DESIGN.md 语义：绿=完成/持久，中性=在办，弱化=已删。 */
export function toStatusBadgeVariant(status: TodoItemStatus): "default" | "story" | "outline" {
  switch (status) {
    case "completed":
      return "story";
    case "removed":
      return "outline";
    case "pending":
      return "default";
  }
}

/** 把重复间隔毫秒转人类可读（如 86400000 → 「每 1 天」）；null 返回占位。 */
export function formatRepeatEvery(repeatEveryMs: number | null, fallback = "—"): string {
  if (repeatEveryMs === null || repeatEveryMs <= 0) {
    return fallback;
  }

  const units: [number, string][] = [
    [86_400_000, "天"],
    [3_600_000, "小时"],
    [60_000, "分钟"],
    [1_000, "秒"],
  ];

  for (const [ms, label] of units) {
    if (repeatEveryMs % ms === 0) {
      return `每 ${repeatEveryMs / ms} ${label}`;
    }
  }

  return `每 ${Math.round(repeatEveryMs / 1000)} 秒`;
}
