DROP TABLE "napcat_group_message_chunk";

DROP TABLE "embedding_cache";

ALTER TABLE "story_rag" RENAME TO "story_memory_document";

ALTER TABLE "story_memory_document"
  RENAME CONSTRAINT "story_rag_pkey" TO "story_memory_document_pkey";

ALTER TABLE "story_memory_document"
  RENAME CONSTRAINT "story_rag_story_id_fkey" TO "story_memory_document_story_id_fkey";

ALTER INDEX "story_rag_story_id_kind_uq"
  RENAME TO "story_memory_document_story_id_kind_uq";

ALTER INDEX "story_rag_story_id_idx"
  RENAME TO "story_memory_document_story_id_idx";

ALTER INDEX "story_rag_embedding_ivfflat_idx"
  RENAME TO "story_memory_document_embedding_ivfflat_idx";

ALTER SEQUENCE "story_rag_id_seq"
  RENAME TO "story_memory_document_id_seq";
