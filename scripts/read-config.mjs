import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const key = process.argv[2];

if (!key) {
  throw new Error("Usage: node scripts/read-config.mjs <dot.path>");
}

const configPath = await resolveConfigPath(rootDir);
const fileContent = await readFile(configPath, "utf8");
const config = parse(fileContent);
const value = key.split(".").reduce((current, segment) => current?.[segment], config);

if (typeof value !== "string" || value.length === 0) {
  throw new Error(`config.yaml 缺少合法的 ${key}`);
}

process.stdout.write(value);

async function resolveConfigPath(repoRoot) {
  const direct = path.join(repoRoot, "config.yaml");
  if (existsSync(direct)) return direct;

  const mainRoot = await findGitWorktreeMainRoot(repoRoot);
  if (mainRoot) {
    const candidate = path.join(mainRoot, "config.yaml");
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    `未找到 config.yaml（已查找：${direct}${mainRoot ? `、${path.join(mainRoot, "config.yaml")}` : ""}）`,
  );
}

async function findGitWorktreeMainRoot(repoRoot) {
  const dotGit = path.join(repoRoot, ".git");
  if (!existsSync(dotGit) || !statSync(dotGit).isFile()) return null;

  const content = await readFile(dotGit, "utf8");
  const match = content.match(/^gitdir:\s*(.+)$/m);
  if (!match) return null;

  const gitDir = path.resolve(repoRoot, match[1].trim());
  const commondirFile = path.join(gitDir, "commondir");
  if (!existsSync(commondirFile)) return null;

  const commondirContent = (await readFile(commondirFile, "utf8")).trim();
  return path.dirname(path.resolve(gitDir, commondirContent));
}
