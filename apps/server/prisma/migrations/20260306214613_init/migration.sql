-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_chat_call" (
    "id" SERIAL NOT NULL,
    "request_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "request_payload" JSONB NOT NULL,
    "response_payload" JSONB,
    "error" JSONB,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_chat_call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_log" (
    "id" SERIAL NOT NULL,
    "trace_id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "llm_chat_call_request_id_uq" ON "llm_chat_call"("request_id");

-- CreateIndex
CREATE INDEX "llm_chat_call_provider_model_idx" ON "llm_chat_call"("provider", "model");

-- CreateIndex
CREATE INDEX "llm_chat_call_created_at_idx" ON "llm_chat_call"("created_at");

-- CreateIndex
CREATE INDEX "app_log_trace_id_created_at_idx" ON "app_log"("trace_id", "created_at");

-- CreateIndex
CREATE INDEX "app_log_level_created_at_idx" ON "app_log"("level", "created_at");

-- CreateIndex
CREATE INDEX "app_log_created_at_idx" ON "app_log"("created_at");

