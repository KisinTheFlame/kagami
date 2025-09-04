-- Kagami 数据库初始化脚本
-- 创建所有必要的表结构

-- LLM 调用日志表
CREATE TABLE IF NOT EXISTS llm_call_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('success', 'fail')),
    input TEXT NOT NULL,
    output TEXT NOT NULL
);

-- 为时间戳字段创建索引，便于按时间查询
CREATE INDEX IF NOT EXISTS idx_llm_call_logs_timestamp ON llm_call_logs(timestamp);

-- 为状态字段创建索引，便于按状态查询
CREATE INDEX IF NOT EXISTS idx_llm_call_logs_status ON llm_call_logs(status);