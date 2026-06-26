-- CreateTable
CREATE TABLE "image_asset" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "file_id" TEXT NOT NULL,
    "resid" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "mime" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "image_asset_file_id_uq" ON "image_asset"("file_id");
