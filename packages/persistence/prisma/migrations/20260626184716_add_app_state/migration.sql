-- CreateTable
CREATE TABLE "app_state" (
    "app_id" TEXT NOT NULL PRIMARY KEY,
    "state" JSONB NOT NULL,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
