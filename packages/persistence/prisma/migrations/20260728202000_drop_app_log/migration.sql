-- app_log 迁往 kagami-observatory 独占库（issue #608）。
--
-- 不做数据搬迁：日志保留窗口只有 7 天、约 195 行/天，是可弃数据；切换当天管理台会看到一段
-- 日志断层，一周后自然抹平。回滚需要手工重建本表（DDL 见 issue #608 的 Rollback Plan）。
DROP TABLE IF EXISTS "app_log";
