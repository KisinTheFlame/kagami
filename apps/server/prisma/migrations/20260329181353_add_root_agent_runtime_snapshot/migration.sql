-- CreateTable
CREATE TABLE "root_agent_runtime_snapshot" (
    "id" SERIAL NOT NULL,
    "runtime_key" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "context_snapshot" JSONB NOT NULL,
    "session_snapshot" JSONB NOT NULL,
    "last_wake_reminder_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "root_agent_runtime_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "root_agent_runtime_snapshot_runtime_key_uq" ON "root_agent_runtime_snapshot"("runtime_key");
