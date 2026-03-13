ALTER TABLE "llm_chat_call"
ADD COLUMN "native_request_payload" JSONB,
ADD COLUMN "native_response_payload" JSONB,
ADD COLUMN "native_error" JSONB;
