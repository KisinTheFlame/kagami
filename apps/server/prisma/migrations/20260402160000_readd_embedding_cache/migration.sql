CREATE TABLE "embedding_cache" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "output_dimensionality" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "text_hash" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[] NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "embedding_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "embedding_cache_provider_model_task_output_text_hash_uq"
ON "embedding_cache"("provider", "model", "task_type", "output_dimensionality", "text_hash");

CREATE INDEX "embedding_cache_created_at_idx"
ON "embedding_cache"("created_at");
