-- 图表定义从 DB 迁回代码（issue #444）：删除 metric_chart 表。
-- 图表现由前端 <MetricChart> 组件在使用处内联声明，metric 服务只按内联规格聚合，不再存图表定义。
DROP TABLE "metric_chart";
