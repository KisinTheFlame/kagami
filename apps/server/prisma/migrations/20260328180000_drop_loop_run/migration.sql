DROP INDEX IF EXISTS "llm_chat_call_loop_run_id_idx";

ALTER TABLE "llm_chat_call"
DROP COLUMN IF EXISTS "loop_run_id";

DROP TABLE IF EXISTS "loop_run_step";
DROP TABLE IF EXISTS "loop_run";
