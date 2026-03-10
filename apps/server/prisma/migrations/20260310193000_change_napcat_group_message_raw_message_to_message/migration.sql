-- AlterTable
ALTER TABLE "napcat_group_message" ADD COLUMN "message" JSONB;

-- Backfill
UPDATE "napcat_group_message"
SET "message" = COALESCE("payload"->'message', '[]'::jsonb);

-- Enforce not null after backfill
ALTER TABLE "napcat_group_message"
ALTER COLUMN "message" SET NOT NULL;

-- Drop legacy column
ALTER TABLE "napcat_group_message" DROP COLUMN "raw_message";
