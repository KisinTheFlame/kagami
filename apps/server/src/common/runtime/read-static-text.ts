import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function resolveServerStaticDir(moduleUrl: string): string {
  let currentDir = dirname(fileURLToPath(moduleUrl));

  while (true) {
    const currentName = basename(currentDir);

    if (currentName === "src" || currentName === "dist") {
      return join(dirname(currentDir), "static");
    }

    const parentDir = dirname(currentDir);

    if (parentDir === currentDir) {
      throw new Error(`Unable to resolve server static directory from module URL: ${moduleUrl}`);
    }

    currentDir = parentDir;
  }
}

export function readServerStaticText(moduleUrl: string, fileName: string): string {
  const filePath = join(resolveServerStaticDir(moduleUrl), fileName);

  if (!existsSync(filePath)) {
    throw new Error(`Static file not found: ${filePath}`);
  }

  return readFileSync(filePath, "utf8");
}
