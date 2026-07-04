-- CreateTable
CREATE TABLE "inner_thought" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "triggered_at" DATETIME NOT NULL,
    "outcome" TEXT NOT NULL,
    "thought" TEXT NOT NULL,
    "runtime_key" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "inner_thought_outcome_created_at_id_idx" ON "inner_thought"("outcome", "created_at", "id");

-- CreateIndex
CREATE INDEX "inner_thought_created_at_idx" ON "inner_thought"("created_at");
