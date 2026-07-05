-- CreateTable
CREATE TABLE "claude_file_cache" (
    "content_sha256" TEXT NOT NULL PRIMARY KEY,
    "file_id" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "claude_file_cache_created_at_idx" ON "claude_file_cache"("created_at");
