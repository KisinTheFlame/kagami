// === 共享交互式图例 ===
//
// 渲染在 recharts 图表树之外——这样「全部隐藏」时图表区换成占位、图例仍常驻可点恢复。每项是 button
// （Tab 可达、Enter/Space 触发、aria-pressed 播报显隐），隐藏态灰显 + label 删除线。只消费传入的 color
// 字符串（必须是 resolved 值，如 hsl(var(--llm))；`var(--color-*)` 在 ChartContainer 外不解析），
// 不解析主题、不碰 chartConfig。样式对齐原 ChartLegendContent（居中、换行、色块 h-2 w-2）。

export type LegendSeries = {
  /** 稳定标识：MetricChartView 传 series.key，缓存图传固定 dataKey。 */
  id: string;
  label: string;
  /** resolved 颜色字符串（如 hsl(var(--llm))）。 */
  color: string;
};

type SeriesLegendProps = {
  /** 完整序列（含隐藏项，隐藏项也要在图例里才能点回来）。 */
  series: LegendSeries[];
  isHidden: (id: string) => boolean;
  onToggle: (id: string) => void;
};

export function SeriesLegend({ series, isHidden, onToggle }: SeriesLegendProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-3">
      {series.map(item => {
        const hidden = isHidden(item.id);
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={!hidden}
            onClick={() => onToggle(item.id)}
            className={`flex cursor-pointer items-center gap-1.5 text-sm transition-opacity ${
              hidden ? "opacity-40" : "opacity-100"
            }`}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: item.color }}
            />
            <span className={hidden ? "line-through" : undefined}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
