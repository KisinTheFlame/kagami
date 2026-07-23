-- issue #555：usage 收窄为 KV 缓存身份，调用归因改由 scene 承接。
-- scene 是可空 TEXT 列（chat 调用写业务归因，chatDirect 写 NULL），无默认值属常量安全，
-- 不触发 SQLite ADD COLUMN 非常量默认（P3018）；生产 migrate deploy 无表重建。
ALTER TABLE "llm_chat_call" ADD COLUMN "scene" TEXT;

-- console LLM 历史页按 scene 筛选用（标量列 + 复合索引，不走 json_extract）。
CREATE INDEX "llm_chat_call_scene_created_at_idx" ON "llm_chat_call"("scene", "created_at");
