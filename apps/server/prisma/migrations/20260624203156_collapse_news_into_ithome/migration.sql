/*
  把"资讯源"从带 source_key 的多源 news 模型收敛为单一 ithome：
  - news_article  → ithome_article（丢弃 source_key，upstream_id 单独唯一）
  - news_feed_cursor → ithome_feed_cursor（游标退化为单行，主键固定 1）

  逐表重建并 INSERT SELECT 复制数据，保留已抓取的文章与已读游标，而非 DROP 重建。
  现存数据本就只有 ithome 一个来源，复制时直接丢弃 source_key 列。
*/
PRAGMA foreign_keys=off;

-- ithome_article：从 news_article 迁移数据，去掉 source_key
CREATE TABLE "ithome_article" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "upstream_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "published_at" DATETIME NOT NULL,
    "rss_summary" TEXT NOT NULL,
    "rss_payload" JSONB NOT NULL,
    "article_content" TEXT,
    "article_content_status" TEXT NOT NULL DEFAULT 'pending',
    "article_content_fetched_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "ithome_article" ("id", "upstream_id", "title", "url", "published_at", "rss_summary", "rss_payload", "article_content", "article_content_status", "article_content_fetched_at", "created_at", "updated_at")
SELECT "id", "upstream_id", "title", "url", "published_at", "rss_summary", "rss_payload", "article_content", "article_content_status", "article_content_fetched_at", "created_at", "updated_at"
FROM "news_article";
DROP TABLE "news_article";

-- ithome_feed_cursor：取原 ithome 源那一行，主键固定为 1
CREATE TABLE "ithome_feed_cursor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "last_seen_article_id" INTEGER NOT NULL,
    "last_seen_published_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "ithome_feed_cursor" ("id", "last_seen_article_id", "last_seen_published_at", "created_at", "updated_at")
SELECT 1, "last_seen_article_id", "last_seen_published_at", "created_at", "updated_at"
FROM "news_feed_cursor"
WHERE "source_key" = 'ithome'
LIMIT 1;
DROP TABLE "news_feed_cursor";

PRAGMA foreign_keys=on;

-- CreateIndex
CREATE UNIQUE INDEX "ithome_article_upstream_id_uq" ON "ithome_article"("upstream_id");

-- CreateIndex
CREATE INDEX "ithome_article_published_at_idx" ON "ithome_article"("published_at");
