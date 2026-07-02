/*
  Warnings:

  - Story 记忆系统整体拆除（issue #225）。删除 `story` / `story_memory_document` /
    `story_agent_runtime_snapshot` 三张表及其全部数据。`ledger`（消息账本）与
    `embedding_cache`（embedding 缓存）保留。
*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "story_memory_document";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "story";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "story_agent_runtime_snapshot";
PRAGMA foreign_keys=on;
