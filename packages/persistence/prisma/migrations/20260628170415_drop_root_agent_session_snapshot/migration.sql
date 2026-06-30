/*
  Warnings:

  - You are about to drop the column `session_snapshot` on the `root_agent_runtime_snapshot` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_root_agent_runtime_snapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runtime_key" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "context_snapshot" JSONB NOT NULL,
    "last_wake_reminder_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_root_agent_runtime_snapshot" ("context_snapshot", "created_at", "id", "last_wake_reminder_at", "runtime_key", "schema_version", "updated_at") SELECT "context_snapshot", "created_at", "id", "last_wake_reminder_at", "runtime_key", "schema_version", "updated_at" FROM "root_agent_runtime_snapshot";
DROP TABLE "root_agent_runtime_snapshot";
ALTER TABLE "new_root_agent_runtime_snapshot" RENAME TO "root_agent_runtime_snapshot";
CREATE UNIQUE INDEX "root_agent_runtime_snapshot_runtime_key_uq" ON "root_agent_runtime_snapshot"("runtime_key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
