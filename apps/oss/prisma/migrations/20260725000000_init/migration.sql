-- CreateTable
CREATE TABLE "blob" (
    "sha256" TEXT NOT NULL PRIMARY KEY,
    "size" INTEGER NOT NULL,
    "refcount" INTEGER NOT NULL,
    "created_at" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "object" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sha256" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL,
    CONSTRAINT "object_sha256_fkey" FOREIGN KEY ("sha256") REFERENCES "blob" ("sha256") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "idx_object_sha256" ON "object"("sha256");
