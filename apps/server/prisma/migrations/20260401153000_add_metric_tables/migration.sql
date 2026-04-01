CREATE TABLE "metric" (
    "id" SERIAL NOT NULL,
    "metric_name" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "tags" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "metric_metric_name_occurred_at_idx"
ON "metric"("metric_name", "occurred_at");

CREATE INDEX "metric_created_at_idx"
ON "metric"("created_at");

CREATE TABLE "metric_chart" (
    "id" SERIAL NOT NULL,
    "chart_name" TEXT NOT NULL,
    "metric_name" TEXT NOT NULL,
    "aggregator" TEXT NOT NULL,
    "tag_filters" JSONB,
    "group_by_tag" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_chart_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "metric_chart_chart_name_uq"
ON "metric_chart"("chart_name");
