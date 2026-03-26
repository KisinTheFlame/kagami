-- CreateTable
CREATE TABLE "news_article" (
    "id" SERIAL NOT NULL,
    "upstream_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "feed_summary" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "author" TEXT,
    "url" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "topics" TEXT[],
    "difficulty" TEXT,
    "read_time_min" INTEGER,
    "quality_score" INTEGER,
    "freshness_score" INTEGER,
    "hot_score" INTEGER,
    "article_title" TEXT,
    "article_excerpt" TEXT,
    "article_content" TEXT,
    "article_content_status" TEXT NOT NULL DEFAULT 'pending',
    "article_content_error" TEXT,
    "article_content_fetched_at" TIMESTAMPTZ(6),
    "summary" TEXT,
    "summary_status" TEXT NOT NULL DEFAULT 'pending',
    "summary_error" TEXT,
    "summary_generated_at" TIMESTAMPTZ(6),
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_dispatch" (
    "id" SERIAL NOT NULL,
    "article_id" INTEGER NOT NULL,
    "group_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "leased_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "news_article_upstream_id_uq" ON "news_article"("upstream_id");

-- CreateIndex
CREATE INDEX "news_article_published_at_idx" ON "news_article"("published_at");

-- CreateIndex
CREATE INDEX "news_article_status_created_at_idx" ON "news_article"("article_content_status", "summary_status", "created_at");

-- CreateIndex
CREATE INDEX "news_dispatch_group_id_status_created_at_idx" ON "news_dispatch"("group_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "news_dispatch_article_id_group_id_uq" ON "news_dispatch"("article_id", "group_id");

-- AddForeignKey
ALTER TABLE "news_dispatch" ADD CONSTRAINT "news_dispatch_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "news_article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
