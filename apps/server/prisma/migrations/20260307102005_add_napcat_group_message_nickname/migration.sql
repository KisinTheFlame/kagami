-- AlterTable
ALTER TABLE "napcat_group_message" ADD COLUMN     "nickname" TEXT;

-- CreateIndex
CREATE INDEX "napcat_group_message_nickname_created_at_idx" ON "napcat_group_message"("nickname", "created_at");
