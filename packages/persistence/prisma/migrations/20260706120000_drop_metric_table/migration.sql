-- metric 存储迁到 kagami-metric 独占的 DuckDB 库（列式，为 p95/分析聚合而生，#475 P1）。
-- 共享 SQLite 里的旧 metric 表退役：历史观测数据无留存价值（用户决定），直接 drop，新库从零起。
DROP TABLE "metric";
