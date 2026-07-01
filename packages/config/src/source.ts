import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { ConfigError } from "./errors.js";

const CONFIG_FILE_NAME = "config.yaml";
const SECRET_FILE_NAME = "config.secret.yaml";

// ============================================================================
// 定位：仓库根的 config.yaml（此前在 kernel / gateway / oss / read-config.mjs
// 四处各自重复实现的锚点逻辑，在此收敛为单一事实来源）。
// ============================================================================

/**
 * 若 `repoRoot` 是一个 git worktree（其 `.git` 是文件而非目录），返回它的主 worktree
 * 根目录，否则返回 null。用于 worktree 下回退到主仓库根定位 config.yaml。
 */
export function findGitWorktreeMainRoot(repoRoot: string): string | null {
  const dotGit = path.join(repoRoot, ".git");
  if (!existsSync(dotGit) || !statSync(dotGit).isFile()) return null;

  const content = readFileSync(dotGit, "utf8");
  const match = content.match(/^gitdir:\s*(.+)$/m);
  if (!match) return null;

  const gitDir = path.resolve(repoRoot, match[1].trim());
  const commondirFile = path.join(gitDir, "commondir");
  if (!existsSync(commondirFile)) return null;

  const commondirContent = readFileSync(commondirFile, "utf8").trim();
  return path.dirname(path.resolve(gitDir, commondirContent));
}

function* ancestorDirs(startDir: string): Generator<string> {
  let dir = path.resolve(startDir);
  while (true) {
    yield dir;
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/**
 * 定位仓库根的 `config.yaml`（depth-agnostic，不依赖调用方在 dist 里的层级）：
 * 1. 从 cwd 逐级向上找 `config.yaml`（cwd = 仓库根 或 apps/<x> 均命中，取最近祖先）。
 * 2. 若给了 `anchorUrl`（调用方的 `import.meta.url`），再从其所在目录逐级向上找
 *    （覆盖「cwd 在仓库外但代码在仓库内」的场景）。
 * 3. worktree 回退：沿祖先探测 git worktree 主根，取其 `config.yaml`（committed 后
 *    worktree 自带 config.yaml，步骤 1 即命中；此步兜底 gitignored 的旧形态）。
 * 找不到 → 抛 `ConfigError(CONFIG_NOT_FOUND)`。
 */
export function resolveConfigPath(anchorUrl?: string): string {
  const searchDirs = [process.cwd()];
  if (anchorUrl) {
    searchDirs.push(path.dirname(fileURLToPath(anchorUrl)));
  }

  for (const start of searchDirs) {
    for (const dir of ancestorDirs(start)) {
      const candidate = path.join(dir, CONFIG_FILE_NAME);
      if (existsSync(candidate)) return candidate;
    }
  }

  for (const start of searchDirs) {
    for (const dir of ancestorDirs(start)) {
      const mainRoot = findGitWorktreeMainRoot(dir);
      if (mainRoot) {
        const candidate = path.join(mainRoot, CONFIG_FILE_NAME);
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  throw new ConfigError({
    message: "未找到 config.yaml",
    meta: { key: CONFIG_FILE_NAME, reason: "CONFIG_NOT_FOUND" },
  });
}

/** 隐私配置文件路径 = 与 config.yaml 同目录的兄弟 `config.secret.yaml`。 */
export function resolveSecretConfigPath(configPath: string): string {
  return path.join(path.dirname(configPath), SECRET_FILE_NAME);
}

// ============================================================================
// 合并：config.yaml（非隐私）+ config.secret.yaml（隐私）→ 单个 raw 对象。
// 本模块领域无关，不认识任何具体配置字段；「哪些路径算隐私」由调用方以白名单传入。
// ============================================================================

// 原型污染防护：拒绝把这些键从 override 合并进来（YAML 可把 __proto__ 表示为 own key）。
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 深合并两个普通对象：仅当同一键在双方都是普通对象时才递归合并；数组与标量由
 * `override` 整体覆盖（不逐元素拼接）。返回新对象，不修改入参。
 * `override` 里的 `__proto__` / `constructor` / `prototype` 键被丢弃以防原型污染。
 */
export function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    const baseHasKey = Object.prototype.hasOwnProperty.call(base, key);
    result[key] = baseHasKey ? deepMerge(base[key], overrideValue) : overrideValue;
  }
  return result;
}

function collectLeafPaths(value: unknown, prefix: string, out: string[]): void {
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectLeafPaths(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }
  if (prefix) out.push(prefix);
}

/**
 * 校验 `secret` 的每个叶子（点分路径）都落在 `allowedPaths` 白名单前缀内。
 * 越界即抛 `ConfigError(CONFIG_SECRET_FORBIDDEN_KEY)`——这道闸保证隐私文件永远不能
 * 改动 `services.*` / `server.databaseUrl` 等非隐私拓扑，使 loader 与只读 config.yaml
 * 的轻量 reader（gateway / oss / read-config）读到的共享字段永远一致。
 */
export function assertSecretWhitelist(
  secret: unknown,
  allowedPaths: string[],
  secretConfigPath: string,
): void {
  if (secret === null || secret === undefined) return;
  if (!isPlainObject(secret)) {
    throw new ConfigError({
      message: "config.secret.yaml 根节点必须是对象",
      meta: { key: secretConfigPath, reason: "CONFIG_SECRET_INVALID" },
    });
  }

  const leaves: string[] = [];
  collectLeafPaths(secret, "", leaves);
  for (const leaf of leaves) {
    // 原型污染防护：任何一段是 __proto__ / constructor / prototype 都拒绝——否则嵌在
    // 白名单前缀下的 `<allowed>.__proto__.x` 会通过前缀匹配（deepMerge 另有一层丢弃兜底）。
    if (leaf.split(".").some(segment => DANGEROUS_KEYS.has(segment))) {
      throw new ConfigError({
        message: `config.secret.yaml 含危险键：${leaf}`,
        meta: { key: leaf, reason: "CONFIG_SECRET_FORBIDDEN_KEY" },
      });
    }
    const allowed = allowedPaths.some(prefix => leaf === prefix || leaf.startsWith(`${prefix}.`));
    if (!allowed) {
      throw new ConfigError({
        message: `config.secret.yaml 含不允许的键：${leaf}（只能放隐私字段）`,
        meta: { key: leaf, reason: "CONFIG_SECRET_FORBIDDEN_KEY" },
      });
    }
  }
}

export type SecretMergeOptions = {
  /** 缺失 config.secret.yaml 时：true 抛 CONFIG_SECRET_NOT_FOUND；false 视为空合并。 */
  required: boolean;
  /** 允许出现在 config.secret.yaml 里的隐私路径前缀白名单。 */
  allowedPaths: string[];
};

export type LoadMergedRawConfigOptions = {
  /** 显式 config.yaml 路径（测试注入）；缺省则 resolveConfigPath 定位。 */
  configPath?: string;
  /** 调用方的 import.meta.url，供 resolveConfigPath 做 depth-agnostic 向上定位。 */
  anchorUrl?: string;
  /** 提供则读取并合并 config.secret.yaml；不提供则只读 config.yaml。 */
  secret?: SecretMergeOptions;
};

export type LoadedRawConfig = {
  configPath: string;
  raw: unknown;
};

async function readYamlFile(filePath: string, invalidReason: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    throw new ConfigError({
      message: "读取配置文件失败",
      meta: { key: filePath, reason: "CONFIG_READ_FAILED" },
      cause: error,
    });
  }

  try {
    return parse(content);
  } catch (error) {
    throw new ConfigError({
      message: "配置文件不是合法的 YAML",
      meta: { key: filePath, reason: invalidReason },
      cause: error,
    });
  }
}

/**
 * 定位 + 解析 config.yaml，可选地读取并深合并 config.secret.yaml，返回未经领域校验的
 * raw 对象（Zod 校验留给调用方）。这是 4 个 reader 的公共入口。
 */
export async function loadMergedRawConfig(
  options: LoadMergedRawConfigOptions = {},
): Promise<LoadedRawConfig> {
  const configPath = options.configPath ?? resolveConfigPath(options.anchorUrl);
  const base = await readYamlFile(configPath, "CONFIG_INVALID");

  if (!options.secret) {
    return { configPath, raw: base };
  }

  const secretConfigPath = resolveSecretConfigPath(configPath);
  if (!existsSync(secretConfigPath)) {
    if (options.secret.required) {
      throw new ConfigError({
        message: `未找到 config.secret.yaml，请从模板创建：cp config.secret.yaml.example ${secretConfigPath}`,
        meta: { key: secretConfigPath, reason: "CONFIG_SECRET_NOT_FOUND" },
      });
    }
    return { configPath, raw: base };
  }

  const secret = await readYamlFile(secretConfigPath, "CONFIG_SECRET_INVALID");
  assertSecretWhitelist(secret, options.secret.allowedPaths, secretConfigPath);
  return { configPath, raw: deepMerge(base ?? {}, secret ?? {}) };
}
