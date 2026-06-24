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
CREATE TABLE "app_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trace_id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "metric" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "metric_name" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "tags" JSONB NOT NULL,
    "occurred_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "metric_chart" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chart_name" TEXT NOT NULL,
    "metric_name" TEXT NOT NULL,
    "aggregator" TEXT NOT NULL,
    "tag_filters" JSONB,
    "group_by_tag" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "napcat_event" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "post_type" TEXT NOT NULL,
    "message_type" TEXT,
    "sub_type" TEXT,
    "user_id" TEXT,
    "group_id" TEXT,
    "event_time" DATETIME,
    "payload" JSONB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "napcat_qq_message" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "message_type" TEXT NOT NULL,
    "sub_type" TEXT NOT NULL,
    "group_id" TEXT,
    "user_id" TEXT,
    "nickname" TEXT,
    "message_id" INTEGER,
    "message" JSONB NOT NULL,
    "event_time" DATETIME,
    "payload" JSONB NOT NULL,
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
CREATE TABLE "auth_usage_snapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "provider" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "window_key" TEXT NOT NULL,
    "remaining_percent" REAL NOT NULL,
    "reset_at" DATETIME,
    "captured_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
CREATE TABLE "root_agent_runtime_snapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runtime_key" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "context_snapshot" JSONB NOT NULL,
    "session_snapshot" JSONB NOT NULL,
    "last_wake_reminder_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ledger" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runtime_key" TEXT NOT NULL,
    "message" JSONB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "story" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "markdown" TEXT NOT NULL,
    "source_message_seq_start" INTEGER NOT NULL,
    "source_message_seq_end" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "story_memory_document" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "story_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding_model" TEXT,
    "embedding_dim" INTEGER,
    "embedding" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "story_memory_document_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "story_agent_runtime_snapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runtime_key" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "context_snapshot" JSONB NOT NULL,
    "last_processed_message_seq" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "news_article" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source_key" TEXT NOT NULL,
    "upstream_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "published_at" DATETIME NOT NULL,
    "rss_summary" TEXT NOT NULL,
    "rss_payload" JSONB NOT NULL,
    "article_content" TEXT,
    "article_content_status" TEXT NOT NULL DEFAULT 'pending',
    "article_content_fetched_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "news_feed_cursor" (
    "source_key" TEXT NOT NULL PRIMARY KEY,
    "last_seen_article_id" INTEGER NOT NULL,
    "last_seen_published_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "terminal_state" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cwd" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "terminal_output" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "output_id" TEXT NOT NULL,
    "stdout" TEXT NOT NULL,
    "stderr" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "llm_chat_call_provider_model_idx" ON "llm_chat_call"("provider", "model");

-- CreateIndex
CREATE INDEX "llm_chat_call_created_at_idx" ON "llm_chat_call"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "llm_chat_call_request_id_seq_uq" ON "llm_chat_call"("request_id", "seq");

-- CreateIndex
CREATE INDEX "app_log_trace_id_created_at_idx" ON "app_log"("trace_id", "created_at");

-- CreateIndex
CREATE INDEX "app_log_level_created_at_idx" ON "app_log"("level", "created_at");

-- CreateIndex
CREATE INDEX "app_log_created_at_idx" ON "app_log"("created_at");

-- CreateIndex
CREATE INDEX "metric_metric_name_occurred_at_idx" ON "metric"("metric_name", "occurred_at");

-- CreateIndex
CREATE INDEX "metric_created_at_idx" ON "metric"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "metric_chart_chart_name_uq" ON "metric_chart"("chart_name");

-- CreateIndex
CREATE INDEX "napcat_event_created_at_idx" ON "napcat_event"("created_at");

-- CreateIndex
CREATE INDEX "napcat_event_post_type_created_at_idx" ON "napcat_event"("post_type", "created_at");

-- CreateIndex
CREATE INDEX "napcat_event_message_type_created_at_idx" ON "napcat_event"("message_type", "created_at");

-- CreateIndex
CREATE INDEX "napcat_event_user_id_created_at_idx" ON "napcat_event"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "napcat_qq_message_created_at_idx" ON "napcat_qq_message"("created_at");

-- CreateIndex
CREATE INDEX "napcat_qq_message_message_type_created_at_idx" ON "napcat_qq_message"("message_type", "created_at");

-- CreateIndex
CREATE INDEX "napcat_qq_message_group_id_created_at_idx" ON "napcat_qq_message"("group_id", "created_at");

-- CreateIndex
CREATE INDEX "napcat_qq_message_nickname_created_at_idx" ON "napcat_qq_message"("nickname", "created_at");

-- CreateIndex
CREATE INDEX "napcat_qq_message_user_id_created_at_idx" ON "napcat_qq_message"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "oauth_session_status_updated_at_idx" ON "oauth_session"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_session_provider_uq" ON "oauth_session"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_state_state_uq" ON "oauth_state"("state");

-- CreateIndex
CREATE INDEX "oauth_state_expires_at_idx" ON "oauth_state"("expires_at");

-- CreateIndex
CREATE INDEX "auth_usage_snapshot_provider_account_captured_at_idx" ON "auth_usage_snapshot"("provider", "account_id", "captured_at");

-- CreateIndex
CREATE INDEX "auth_usage_snapshot_provider_account_window_captured_at_idx" ON "auth_usage_snapshot"("provider", "account_id", "window_key", "captured_at");

-- CreateIndex
CREATE INDEX "auth_usage_snapshot_captured_at_idx" ON "auth_usage_snapshot"("captured_at");

-- CreateIndex
CREATE INDEX "embedding_cache_created_at_idx" ON "embedding_cache"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "embedding_cache_provider_model_task_output_text_hash_uq" ON "embedding_cache"("provider", "model", "task_type", "output_dimensionality", "text_hash");

-- CreateIndex
CREATE UNIQUE INDEX "root_agent_runtime_snapshot_runtime_key_uq" ON "root_agent_runtime_snapshot"("runtime_key");

-- CreateIndex
CREATE INDEX "ledger_runtime_key_id_idx" ON "ledger"("runtime_key", "id");

-- CreateIndex
CREATE INDEX "ledger_created_at_idx" ON "ledger"("created_at");

-- CreateIndex
CREATE INDEX "story_updated_at_idx" ON "story"("updated_at");

-- CreateIndex
CREATE INDEX "story_source_message_seq_end_idx" ON "story"("source_message_seq_end");

-- CreateIndex
CREATE INDEX "story_memory_document_story_id_idx" ON "story_memory_document"("story_id");

-- CreateIndex
CREATE UNIQUE INDEX "story_memory_document_story_id_kind_uq" ON "story_memory_document"("story_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "story_agent_runtime_snapshot_runtime_key_uq" ON "story_agent_runtime_snapshot"("runtime_key");

-- CreateIndex
CREATE INDEX "news_article_source_key_published_at_idx" ON "news_article"("source_key", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "news_article_source_key_upstream_id_uq" ON "news_article"("source_key", "upstream_id");

-- CreateIndex
CREATE UNIQUE INDEX "terminal_output_output_id_uq" ON "terminal_output"("output_id");

-- CreateIndex
CREATE INDEX "terminal_output_created_at_idx" ON "terminal_output"("created_at");
