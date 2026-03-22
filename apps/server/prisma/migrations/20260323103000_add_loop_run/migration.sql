ALTER TABLE "llm_chat_call"
ADD COLUMN "loop_run_id" TEXT;

CREATE INDEX "llm_chat_call_loop_run_id_idx" ON "llm_chat_call"("loop_run_id");

CREATE TABLE "loop_run" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "trigger_message_id" INTEGER,
  "status" TEXT NOT NULL,
  "trigger_payload" JSONB NOT NULL,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(6),
  "duration_ms" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "loop_run_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "loop_run_group_id_created_at_idx" ON "loop_run"("group_id", "created_at");
CREATE INDEX "loop_run_created_at_idx" ON "loop_run"("created_at");

CREATE TABLE "loop_run_step" (
  "id" SERIAL NOT NULL,
  "loop_run_id" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(6),
  "duration_ms" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "loop_run_step_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loop_run_step_loop_run_id_fkey" FOREIGN KEY ("loop_run_id") REFERENCES "loop_run"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "loop_run_step_loop_run_id_seq_uq" ON "loop_run_step"("loop_run_id", "seq");
CREATE INDEX "loop_run_step_loop_run_id_created_at_idx" ON "loop_run_step"("loop_run_id", "created_at");
