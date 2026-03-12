ALTER TABLE "llm_chat_call"
ADD COLUMN "seq" INTEGER NOT NULL DEFAULT 1;

DROP INDEX "llm_chat_call_request_id_uq";

CREATE UNIQUE INDEX "llm_chat_call_request_id_seq_uq"
ON "llm_chat_call"("request_id", "seq");
