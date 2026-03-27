-- Re-create napcat_event after 20260327120000_drop_napcat_event
CREATE TABLE "napcat_event" (
    "id" SERIAL NOT NULL,
    "post_type" TEXT NOT NULL,
    "message_type" TEXT,
    "sub_type" TEXT,
    "user_id" TEXT,
    "group_id" TEXT,
    "raw_message" TEXT,
    "event_time" TIMESTAMPTZ(6),
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "napcat_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "napcat_event_created_at_idx" ON "napcat_event"("created_at");
CREATE INDEX "napcat_event_post_type_created_at_idx" ON "napcat_event"("post_type", "created_at");
CREATE INDEX "napcat_event_message_type_created_at_idx" ON "napcat_event"("message_type", "created_at");
CREATE INDEX "napcat_event_user_id_created_at_idx" ON "napcat_event"("user_id", "created_at");
