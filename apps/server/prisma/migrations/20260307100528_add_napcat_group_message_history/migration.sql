-- CreateTable
CREATE TABLE "napcat_group_message" (
    "id" SERIAL NOT NULL,
    "group_id" TEXT NOT NULL,
    "user_id" TEXT,
    "message_id" INTEGER,
    "raw_message" TEXT NOT NULL,
    "event_time" TIMESTAMPTZ(6),
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "napcat_group_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "napcat_group_message_created_at_idx" ON "napcat_group_message"("created_at");

-- CreateIndex
CREATE INDEX "napcat_group_message_group_id_created_at_idx" ON "napcat_group_message"("group_id", "created_at");

-- CreateIndex
CREATE INDEX "napcat_group_message_user_id_created_at_idx" ON "napcat_group_message"("user_id", "created_at");
