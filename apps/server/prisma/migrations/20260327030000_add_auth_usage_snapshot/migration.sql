CREATE TABLE "auth_usage_snapshot" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "window_key" TEXT NOT NULL,
    "used_percent" DOUBLE PRECISION NOT NULL,
    "reset_at" TIMESTAMPTZ(6),
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_usage_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auth_usage_snapshot_provider_account_captured_at_idx"
ON "auth_usage_snapshot"("provider", "account_id", "captured_at");

CREATE INDEX "auth_usage_snapshot_provider_account_window_captured_at_idx"
ON "auth_usage_snapshot"("provider", "account_id", "window_key", "captured_at");

CREATE INDEX "auth_usage_snapshot_captured_at_idx"
ON "auth_usage_snapshot"("captured_at");
