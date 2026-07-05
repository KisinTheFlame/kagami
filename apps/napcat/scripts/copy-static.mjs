import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(scriptDir, "..");
const sourceDir = resolve(serverDir, "static");
const targetDir = resolve(serverDir, "dist", "static");

if (!existsSync(sourceDir)) {
  process.exit(0);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(dirname(targetDir), { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });
