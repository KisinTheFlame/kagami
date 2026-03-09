import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const key = process.argv[2];

if (!key) {
  throw new Error("Usage: node scripts/read-config.mjs <dot.path>");
}

const fileContent = await readFile(path.join(rootDir, "config.yaml"), "utf8");
const config = parse(fileContent);
const value = key.split(".").reduce((current, segment) => current?.[segment], config);

if (typeof value !== "string" || value.length === 0) {
  throw new Error(`config.yaml 缺少合法的 ${key}`);
}

process.stdout.write(value);
