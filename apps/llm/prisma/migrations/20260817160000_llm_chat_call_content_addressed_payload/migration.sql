-- issue #612：llm_chat_call 请求体改内容寻址存储。
--
-- ReAct 每轮重发全部历史，逐轮存一份完整 request_payload 让单会话累计写入呈 O(轮数²)；
-- 生产实测 10 行占 72.7 MB，23104 条 message 引用里只有 11%（2540 条）是唯一的。
-- 改成 messages 逐条进 llm_blob（内容寻址 + zstd），行内只留有序 blob id，写入降到 O(轮数)。
--
-- native_request_payload 是 request 的另一份 provider wire 序列化、占改动前一半空间，直接删列。
-- native_error / native_response_payload **保留**：O(1)/行，且是 provider 4xx 真因的唯一落点。

-- 存量行无法映射到新形状，且保留窗口本就是 1 天（这些行 24 小时内必然被 retention 删掉），
-- 为它们写一套一天后即成死代码的兼容读路径不划算。清表后再改结构。
DELETE FROM "llm_chat_call";

-- 表重建：SQLite 的 DROP COLUMN 对带索引/约束的表限制多，且这里要同时删 2 列加 2 列，
-- 直接按目标形状重建最干净（表已清空，无数据搬迁）。索引名与旧表逐字保持一致。
DROP INDEX "llm_chat_call_request_id_seq_uq";
DROP INDEX "llm_chat_call_provider_model_idx";
DROP INDEX "llm_chat_call_created_at_idx";
DROP INDEX "llm_chat_call_scene_created_at_idx";
DROP TABLE "llm_chat_call";

CREATE TABLE "llm_chat_call" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "request_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "scene" TEXT,
    "extension" JSONB,
    "status" TEXT NOT NULL,
    "request_skeleton" JSONB NOT NULL,
    "message_refs" BLOB NOT NULL,
    "response_payload" JSONB,
    "native_response_payload" JSONB,
    "error" JSONB,
    "native_error" JSONB,
    "latency_ms" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "llm_chat_call_request_id_seq_uq" ON "llm_chat_call"("request_id", "seq");
CREATE INDEX "llm_chat_call_provider_model_idx" ON "llm_chat_call"("provider", "model");
CREATE INDEX "llm_chat_call_created_at_idx" ON "llm_chat_call"("created_at");
CREATE INDEX "llm_chat_call_scene_created_at_idx" ON "llm_chat_call"("scene", "created_at");

-- 内容寻址分片表：hash = 未压缩原始字节的 sha256；bytes 按 codec 存（zstd / raw）。
CREATE TABLE "llm_blob" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "hash" BLOB NOT NULL,
    "codec" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "stored_bytes" INTEGER NOT NULL,
    "bytes" BLOB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- mark-sweep 的安全带：命中复用即续期，GC 只回收一个宽限窗口内没被引用过的 blob，
    -- 堵住「mark 之后 sweep 之前被重新引用」这个悬挂引用窗口。
    "last_used_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "llm_blob_hash_uq" ON "llm_blob"("hash");
CREATE INDEX "llm_blob_last_used_at_idx" ON "llm_blob"("last_used_at");
