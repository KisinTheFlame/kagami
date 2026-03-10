CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "napcat_group_message_chunk" (
    "id" SERIAL NOT NULL,
    "source_message_id" INTEGER NOT NULL,
    "group_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "embedding_model" TEXT,
    "embedding_dim" INTEGER,
    "embedding" vector(768),
    "error_message" TEXT,
    "indexed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "napcat_group_message_chunk_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "napcat_group_message_chunk_source_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "napcat_group_message"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "napcat_group_message_chunk_source_chunk_idx_uq"
ON "napcat_group_message_chunk"("source_message_id", "chunk_index");

CREATE INDEX "napcat_group_message_chunk_group_status_created_at_idx"
ON "napcat_group_message_chunk"("group_id", "status", "created_at");

CREATE INDEX "napcat_group_message_chunk_source_message_id_idx"
ON "napcat_group_message_chunk"("source_message_id");

CREATE INDEX "napcat_group_message_chunk_embedding_ivfflat_idx"
ON "napcat_group_message_chunk" USING ivfflat ("embedding" vector_cosine_ops)
WITH (lists = 100);
