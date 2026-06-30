/*
  Warnings:

  - You are about to drop the column `mime` on the `image_asset` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_image_asset" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "file_id" TEXT NOT NULL,
    "resid" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_image_asset" ("created_at", "description", "file_id", "id", "resid") SELECT "created_at", "description", "file_id", "id", "resid" FROM "image_asset";
DROP TABLE "image_asset";
ALTER TABLE "new_image_asset" RENAME TO "image_asset";
CREATE UNIQUE INDEX "image_asset_file_id_uq" ON "image_asset"("file_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
