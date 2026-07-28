-- CreateTable
CREATE TABLE "app_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "service" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "app_log_created_at_idx" ON "app_log"("created_at");

-- CreateIndex
CREATE INDEX "app_log_service_created_at_idx" ON "app_log"("service", "created_at");

-- CreateIndex
CREATE INDEX "app_log_level_created_at_idx" ON "app_log"("level", "created_at");

-- CreateIndex
CREATE INDEX "app_log_trace_id_created_at_idx" ON "app_log"("trace_id", "created_at");
