-- napcat 独占 SQLite 库初始迁移（epic #539 子 issue 2）。
-- 四张表与主库 kagami.db 中的同名表逐列一致（image_asset 为 #176 删掉 mime 后的现行形状），
-- 让启动期数据搬迁可以 ATTACH 主库后按显式列名 INSERT SELECT 整搬、保留自增主键。

-- CreateTable
CREATE TABLE "napcat_event" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "post_type" TEXT NOT NULL,
    "message_type" TEXT,
    "sub_type" TEXT,
    "user_id" TEXT,
    "group_id" TEXT,
    "event_time" DATETIME,
    "payload" JSONB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "napcat_qq_message" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "message_type" TEXT NOT NULL,
    "sub_type" TEXT NOT NULL,
    "group_id" TEXT,
    "user_id" TEXT,
    "nickname" TEXT,
    "message_id" INTEGER,
    "message" JSONB NOT NULL,
    "event_time" DATETIME,
    "payload" JSONB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "napcat_event_outbox" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "event" JSONB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "image_asset" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "file_id" TEXT NOT NULL,
    "resid" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "napcat_event_created_at_idx" ON "napcat_event"("created_at");

-- CreateIndex
CREATE INDEX "napcat_event_post_type_created_at_idx" ON "napcat_event"("post_type", "created_at");

-- CreateIndex
CREATE INDEX "napcat_event_message_type_created_at_idx" ON "napcat_event"("message_type", "created_at");

-- CreateIndex
CREATE INDEX "napcat_event_user_id_created_at_idx" ON "napcat_event"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "napcat_qq_message_created_at_idx" ON "napcat_qq_message"("created_at");

-- CreateIndex
CREATE INDEX "napcat_qq_message_message_type_created_at_idx" ON "napcat_qq_message"("message_type", "created_at");

-- CreateIndex
CREATE INDEX "napcat_qq_message_group_id_created_at_idx" ON "napcat_qq_message"("group_id", "created_at");

-- CreateIndex
CREATE INDEX "napcat_qq_message_nickname_created_at_idx" ON "napcat_qq_message"("nickname", "created_at");

-- CreateIndex
CREATE INDEX "napcat_qq_message_user_id_created_at_idx" ON "napcat_qq_message"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "napcat_event_outbox_created_at_idx" ON "napcat_event_outbox"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "image_asset_file_id_uq" ON "image_asset"("file_id");
