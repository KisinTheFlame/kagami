import { useCallback, useState } from "react";

// === series 显隐的横切机器（与 query / axis / chartType 完全解耦）===
//
// 单查询多序列图（MetricChartView）与双轴 composed 图（DashboardCacheChart）主体不同，但「哪些序列可见」
// 这套逻辑一致：一个按稳定 id 记的隐藏集 + 点击切换。抽在这里，两类图共享一份实现——加新的横切能力
// （显隐属之）不必写两遍。id 是调用方给的稳定标识：MetricChartView 传 series.key（语义 tag 值），
// 缓存图传固定 dataKey（"tokens" / "ratePct"）。hook 不认识这些 id 的来源，只管开关。

/**
 * 隐藏集切换：不可变返回新 Set（原地 add/delete 不会触发 React 重渲染）。
 */
export function toggleHiddenId(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export type SeriesVisibility = {
  /** 当前隐藏的 id 集合（供 useMemo 依赖 / 过滤可见序列）。 */
  hiddenIds: Set<string>;
  toggle: (id: string) => void;
  isHidden: (id: string) => boolean;
};

/**
 * series 显隐状态。纯客户端展示开关，不触发重查；不随数据刷新重置——组件卸载 / 刷新页面自然复位。
 */
export function useSeriesVisibility(): SeriesVisibility {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((id: string) => setHiddenIds(prev => toggleHiddenId(prev, id)), []);
  const isHidden = useCallback((id: string) => hiddenIds.has(id), [hiddenIds]);
  return { hiddenIds, toggle, isHidden };
}
