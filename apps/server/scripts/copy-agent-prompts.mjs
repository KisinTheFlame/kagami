import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(scriptDir, "..");
const sourceRootDir = resolve(serverDir, "src");
const targetRootDir = resolve(serverDir, "dist");

copyPromptDirectories(sourceRootDir);

function copyPromptDirectories(currentDir) {
  if (!existsSync(currentDir)) {
    return;
  }

  for (const entry of readdirSync(currentDir)) {
    const sourcePath = join(currentDir, entry);
    const stats = statSync(sourcePath);
    if (!stats.isDirectory()) {
      continue;
    }

    if (entry === "prompts") {
      const relativePath = relative(sourceRootDir, sourcePath);
      const targetPath = join(targetRootDir, relativePath);
      mkdirSync(targetPath, { recursive: true });
      cpSync(sourcePath, targetPath, { recursive: true });
      continue;
    }

    copyPromptDirectories(sourcePath);
  }
}
