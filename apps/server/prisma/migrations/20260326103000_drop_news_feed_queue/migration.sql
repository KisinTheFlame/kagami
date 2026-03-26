/*
  Warnings:

  - You are about to drop the `news_dispatch` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `news_article` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "news_dispatch" DROP CONSTRAINT "news_dispatch_article_id_fkey";

-- DropTable
DROP TABLE "news_dispatch";

-- DropTable
DROP TABLE "news_article";
