// server 侧只需打点用的标签类型；图表相关的 domain 类型（MetricChartItem / CreateMetricChartInput /
// MetricChartAggregator）已随 metric-chart 链迁往 @kagami/console。MetricTags 是 Record<string,string>
// 平凡别名，与 console 侧、@kagami/server-core 侧的同名定义结构等价、互通。
export type MetricTags = Record<string, string>;
