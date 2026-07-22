-- llm 独占 SQLite 库初始迁移（epic #539 子 issue 3）。
-- 五张表与主库 kagami.db 中的同名表逐列一致（取自生产库现行 .schema），
-- 让启动期数据搬迁可以按显式列名 INSERT 整搬、保留自增主键。

-- CreateTable
CREATE TABLE "llm_chat_call" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "request_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "extension" JSONB,
    "status" TEXT NOT NULL,
    "request_payload" JSONB NOT NULL,
    "response_payload" JSONB,
    "native_request_payload" JSONB,
    "native_response_payload" JSONB,
    "error" JSONB,
    "native_error" JSONB,
    "latency_ms" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "oauth_session" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "provider" TEXT NOT NULL,
    "account_id" TEXT,
    "email" TEXT,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "expires_at" DATETIME,
    "last_refresh_at" DATETIME,
    "status" TEXT NOT NULL,
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "oauth_state" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "state" TEXT NOT NULL,
    "code_verifier" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "embedding_cache" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "output_dimensionality" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "text_hash" TEXT NOT NULL,
    "embedding" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "claude_file_cache" (
    "content_sha256" TEXT NOT NULL PRIMARY KEY,
    "file_id" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "llm_chat_call_provider_model_idx" ON "llm_chat_call"("provider", "model");

-- CreateIndex
CREATE INDEX "llm_chat_call_created_at_idx" ON "llm_chat_call"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "llm_chat_call_request_id_seq_uq" ON "llm_chat_call"("request_id", "seq");

-- CreateIndex
CREATE INDEX "oauth_session_status_updated_at_idx" ON "oauth_session"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_session_provider_uq" ON "oauth_session"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_state_state_uq" ON "oauth_state"("state");

-- CreateIndex
CREATE INDEX "oauth_state_expires_at_idx" ON "oauth_state"("expires_at");

-- CreateIndex
CREATE INDEX "embedding_cache_created_at_idx" ON "embedding_cache"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "embedding_cache_provider_model_task_output_text_hash_uq" ON "embedding_cache"("provider", "model", "task_type", "output_dimensionality", "text_hash");

-- CreateIndex
CREATE INDEX "claude_file_cache_last_used_at_idx" ON "claude_file_cache"("last_used_at");
