-- OAuth 额度遥测迁到通用 Metric 基座（epic #521）：额度剩余百分比现以
-- llm.oauth.quota.remaining_percent metric 打进 kagami-metric 的 DuckDB 库，
-- 内置登录页趋势图改读 /metric/points。旧专用表 auth_usage_snapshot 退役——
-- 历史快照无留存价值（不 backfill，趋势从部署后重新积累），直接 drop。
DROP TABLE "auth_usage_snapshot";
