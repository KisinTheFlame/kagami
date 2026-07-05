-- AlterTable: 新增 last_used_at（GC 判据）。存量行用 CURRENT_TIMESTAMP 回填到迁移时刻（now），
-- 给每条历史行一个 N 天新租约——避免首轮 GC 误删可能还在冷上下文里的历史图。
ALTER TABLE "claude_file_cache" ADD COLUMN "last_used_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- DropIndex: created_at 不再被 GC 查询（改按 last_used_at）。
DROP INDEX "claude_file_cache_created_at_idx";

-- CreateIndex
CREATE INDEX "claude_file_cache_last_used_at_idx" ON "claude_file_cache"("last_used_at");
