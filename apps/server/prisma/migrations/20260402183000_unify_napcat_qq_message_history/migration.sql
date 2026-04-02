ALTER TABLE "napcat_group_message" RENAME TO "napcat_qq_message";

ALTER TABLE "napcat_qq_message"
  ADD COLUMN "message_type" TEXT,
  ADD COLUMN "sub_type" TEXT;

UPDATE "napcat_qq_message"
SET
  "message_type" = COALESCE("payload"->>'message_type', 'group'),
  "sub_type" = COALESCE("payload"->>'sub_type', 'normal')
WHERE "message_type" IS NULL OR "sub_type" IS NULL;

ALTER TABLE "napcat_qq_message"
  ALTER COLUMN "message_type" SET NOT NULL,
  ALTER COLUMN "sub_type" SET NOT NULL,
  ALTER COLUMN "group_id" DROP NOT NULL;

ALTER INDEX "napcat_group_message_created_at_idx" RENAME TO "napcat_qq_message_created_at_idx";
ALTER INDEX "napcat_group_message_group_id_created_at_idx" RENAME TO "napcat_qq_message_group_id_created_at_idx";
ALTER INDEX "napcat_group_message_nickname_created_at_idx" RENAME TO "napcat_qq_message_nickname_created_at_idx";
ALTER INDEX "napcat_group_message_user_id_created_at_idx" RENAME TO "napcat_qq_message_user_id_created_at_idx";

CREATE INDEX "napcat_qq_message_message_type_created_at_idx"
  ON "napcat_qq_message"("message_type", "created_at");
