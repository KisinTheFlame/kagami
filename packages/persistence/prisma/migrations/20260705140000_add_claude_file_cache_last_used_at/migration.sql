-- 新增 last_used_at（GC 判据，#433）。SQLite 的 `ALTER TABLE ADD COLUMN` 不允许非常量默认值
-- （CURRENT_TIMESTAMP 非常量，会 P3018），故走「建新表 → 拷数据 → 改名」的表重建路径——
-- CREATE TABLE 带 DEFAULT CURRENT_TIMESTAMP 是允许的。存量行 last_used_at 回填到迁移时刻（now），
-- 给每条历史行一个 N 天新租约，避免首轮 GC 误删可能还在冷上下文里的历史图。
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_claude_file_cache" (
    "content_sha256" TEXT NOT NULL PRIMARY KEY,
    "file_id" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "new_claude_file_cache" ("content_sha256", "file_id", "mime_type", "size_bytes", "created_at", "last_used_at")
SELECT "content_sha256", "file_id", "mime_type", "size_bytes", "created_at", CURRENT_TIMESTAMP
FROM "claude_file_cache";

DROP TABLE "claude_file_cache";

ALTER TABLE "new_claude_file_cache" RENAME TO "claude_file_cache";

-- created_at 不再被 GC 查询（改按 last_used_at）：旧表随 DROP 一并消失，只需新建 last_used_at 索引。
CREATE INDEX "claude_file_cache_last_used_at_idx" ON "claude_file_cache"("last_used_at");

PRAGMA foreign_keys=ON;
