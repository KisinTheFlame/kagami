-- CreateTable
CREATE TABLE "napcat_event_outbox" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "event" JSONB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "napcat_event_outbox_created_at_idx" ON "napcat_event_outbox"("created_at");
