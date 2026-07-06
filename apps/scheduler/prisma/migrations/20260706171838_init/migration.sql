-- CreateTable
CREATE TABLE "task_run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "task_name" TEXT NOT NULL,
    "owner_generation" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "scheduled_at" DATETIME,
    "started_at" DATETIME NOT NULL,
    "finished_at" DATETIME,
    "duration_ms" INTEGER,
    "error" TEXT,
    "reported_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "task_run_owner_task_started_idx" ON "task_run"("owner_id", "task_name", "started_at");
