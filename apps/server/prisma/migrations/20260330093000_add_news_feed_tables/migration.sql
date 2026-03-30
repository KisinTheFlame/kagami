-- CreateTable
CREATE TABLE "news_article" (
    "id" SERIAL NOT NULL,
    "source_key" TEXT NOT NULL,
    "upstream_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "rss_summary" TEXT NOT NULL,
    "rss_payload" JSONB NOT NULL,
    "article_content" TEXT,
    "article_content_status" TEXT NOT NULL DEFAULT 'pending',
    "article_content_fetched_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_feed_cursor" (
    "source_key" TEXT NOT NULL,
    "last_seen_article_id" INTEGER NOT NULL,
    "last_seen_published_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_feed_cursor_pkey" PRIMARY KEY ("source_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "news_article_source_key_upstream_id_uq" ON "news_article"("source_key", "upstream_id");

-- CreateIndex
CREATE INDEX "news_article_source_key_published_at_idx" ON "news_article"("source_key", "published_at");
