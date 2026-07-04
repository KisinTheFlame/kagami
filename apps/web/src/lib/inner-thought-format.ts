/**
 * 把两次触发的时间差（毫秒）格式化成「距上次触发间隔」。
 * `null` / 非有限 / 负值（缺上一条、跨页、时钟回拨）一律回 `—`。
 * `+45s` / `+6m12s`（<1h，秒补零）/ `+1h07m`（≥1h，分补零）。
 */
export function formatTriggerInterval(deltaMs: number | null): string {
  if (deltaMs === null || !Number.isFinite(deltaMs) || deltaMs < 0) {
    return "—";
  }

  const totalSeconds = Math.round(deltaMs / 1000);
  if (totalSeconds < 60) {
    return `+${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `+${totalMinutes}m${String(totalSeconds % 60).padStart(2, "0")}s`;
  }

  const hours = Math.floor(totalMinutes / 60);
  return `+${hours}h${String(totalMinutes % 60).padStart(2, "0")}m`;
}
