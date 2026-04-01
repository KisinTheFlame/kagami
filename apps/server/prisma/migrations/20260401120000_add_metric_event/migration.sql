CREATE TABLE "metric_event" (
    "id" SERIAL NOT NULL,
    "metric_key" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usage" TEXT,
    "tool_name" TEXT,
    "request_id" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "total_tokens" INTEGER,
    "cache_hit_tokens" INTEGER,
    "cache_miss_tokens" INTEGER,
    "attributes" JSONB,

    CONSTRAINT "metric_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "metric_event_metric_key_occurred_at_idx"
ON "metric_event"("metric_key", "occurred_at");

CREATE INDEX "metric_event_usage_occurred_at_idx"
ON "metric_event"("usage", "occurred_at");

CREATE INDEX "metric_event_tool_name_occurred_at_idx"
ON "metric_event"("tool_name", "occurred_at");

CREATE INDEX "metric_event_request_id_idx"
ON "metric_event"("request_id");
