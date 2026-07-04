import { useMemo } from "react";
import { Cell, Pie, PieChart } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { seriesColorAt } from "@/lib/observability";

export type ModelBreakdownItem = {
  provider: string;
  model: string;
  count: number;
};

type ModelPieChartProps = {
  items: ModelBreakdownItem[];
  /** 点击某扇区回传该 provider+model，用于下钻到「该 model 时序」。 */
  onSliceClick?: (item: ModelBreakdownItem) => void;
};

/** 模型调用分布饼图：观察台三种图元之一（饼）。扇区可点，是下钻链路的入口。 */
export function ModelPieChart({ items, onSliceClick }: ModelPieChartProps) {
  const config = useMemo<ChartConfig>(() => {
    const entries: ChartConfig = {};
    items.forEach((item, index) => {
      entries[item.model] = { label: item.model, color: seriesColorAt(index) };
    });
    return entries;
  }, [items]);

  return (
    <ChartContainer className="mx-auto aspect-square max-h-72" config={config}>
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent nameKey="model" />} />
        <Pie
          data={items}
          dataKey="count"
          nameKey="model"
          innerRadius={48}
          strokeWidth={2}
          isAnimationActive={false}
          onClick={(_, index) => {
            const item = items[index];
            if (item && onSliceClick) {
              onSliceClick(item);
            }
          }}
        >
          {items.map((item, index) => (
            <Cell
              key={`${item.provider}:${item.model}`}
              fill={seriesColorAt(index)}
              className={onSliceClick ? "cursor-pointer outline-none" : "outline-none"}
            />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}
