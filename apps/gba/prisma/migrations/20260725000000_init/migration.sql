-- CreateTable
CREATE TABLE "rom" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "oss_key" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL,
    "last_played_at" INTEGER
);

-- CreateTable
CREATE TABLE "battery_save" (
    "rom_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bytes" BLOB NOT NULL,
    "updated_at" INTEGER NOT NULL,
    CONSTRAINT "battery_save_rom_id_fkey" FOREIGN KEY ("rom_id") REFERENCES "rom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "run_state" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rom_id" INTEGER,
    CONSTRAINT "run_state_rom_id_fkey" FOREIGN KEY ("rom_id") REFERENCES "rom" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "resume_state" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rom_id" INTEGER NOT NULL,
    "savestate" BLOB NOT NULL,
    "foreground" BOOLEAN NOT NULL,
    "frame" INTEGER NOT NULL,
    "saved_at" INTEGER NOT NULL,
    CONSTRAINT "resume_state_rom_id_fkey" FOREIGN KEY ("rom_id") REFERENCES "rom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "rom_name_key" ON "rom"("name");

-- CreateIndex
CREATE UNIQUE INDEX "rom_sha256_key" ON "rom"("sha256");
