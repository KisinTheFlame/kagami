CREATE TABLE "ledger" (
    "id" SERIAL NOT NULL,
    "runtime_key" TEXT NOT NULL,
    "message" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ledger_runtime_key_id_idx"
ON "ledger"("runtime_key", "id");

CREATE INDEX "ledger_created_at_idx"
ON "ledger"("created_at");

CREATE TABLE "story" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "source_message_seq_start" INTEGER NOT NULL,
    "source_message_seq_end" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "story_updated_at_idx" ON "story"("updated_at");
CREATE INDEX "story_source_message_seq_end_idx" ON "story"("source_message_seq_end");

CREATE TABLE "story_rag" (
    "id" SERIAL NOT NULL,
    "story_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding_model" TEXT,
    "embedding_dim" INTEGER,
    "embedding" vector(768),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_rag_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "story_rag_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "story"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "story_rag_story_id_kind_uq"
ON "story_rag"("story_id", "kind");

CREATE INDEX "story_rag_story_id_idx"
ON "story_rag"("story_id");

CREATE INDEX "story_rag_embedding_ivfflat_idx"
ON "story_rag" USING ivfflat ("embedding" vector_cosine_ops)
WITH (lists = 100);

CREATE TABLE "story_agent_runtime_snapshot" (
    "id" SERIAL NOT NULL,
    "runtime_key" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "context_snapshot" JSONB NOT NULL,
    "last_processed_message_seq" INTEGER NOT NULL DEFAULT 0,
    "bootstrap_completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_agent_runtime_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "story_agent_runtime_snapshot_runtime_key_uq"
ON "story_agent_runtime_snapshot"("runtime_key");
