import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import type { TemplateDelegate as HandlebarsTemplateDelegate } from "handlebars";

const compiledServerStaticTemplateCache = new Map<
  string,
  HandlebarsTemplateDelegate<Record<string, unknown>>
>();

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

export function renderServerStaticTemplate(
  moduleUrl: string,
  fileName: string,
  context: Record<string, unknown> = {},
): string {
  const filePath = join(resolveServerStaticDir(moduleUrl), fileName);

  if (!existsSync(filePath)) {
    throw new Error(`Static file not found: ${filePath}`);
  }

  let compiledTemplate = compiledServerStaticTemplateCache.get(filePath);

  if (!compiledTemplate) {
    compiledTemplate = Handlebars.compile<Record<string, unknown>>(readFileSync(filePath, "utf8"), {
      noEscape: true,
    });
    compiledServerStaticTemplateCache.set(filePath, compiledTemplate);
  }

  return compiledTemplate(context).trimEnd();
}
