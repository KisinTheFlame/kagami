import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadStaticConfig } from "../src/config/config.loader.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * 最小必需 secrets：schema 里 non-empty 的隐私字段。注意 config.secret.yaml.example
 * 的空占位过不了 schema（新 clone 照 example 起会失败），故这里给测试值。
 */
const MINIMAL_SECRET_YAML = `server:
  tavily:
    apiKey: test-tavily-key
  napcat:
    wsUrl: ws://127.0.0.1:3001
    listenGroupIds:
      - 123456
  bot:
    qq: 10001
    creator:
      name: tester
      qq: 10002
`;

/**
 * 用仓库里真实的 config.yaml + 最小 secrets 当夹具：守护「提交的 config.yaml 永远
 * 能通过 loader schema」（三处同步硬约束的机器检查）。
 */
function createFixtureDir(mutate?: (configText: string) => string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "kagami-config-test-"));
  const configText = readFileSync(path.join(repoRoot, "config.yaml"), "utf8");
  writeFileSync(path.join(dir, "config.yaml"), mutate ? mutate(configText) : configText);
  writeFileSync(path.join(dir, "config.secret.yaml"), MINIMAL_SECRET_YAML);
  return dir;
}

describe("loadStaticConfig — 配置装载", () => {
  it("仓库的 config.yaml + 最小 secrets 能通过 schema（三处同步守护）", async () => {
    const dir = createFixtureDir();
    const config = await loadStaticConfig({ configPath: path.join(dir, "config.yaml") });
    expect(config.services.gateway.port).toBeTypeOf("number");
    expect(config.server.llm.timeoutMs).toBeGreaterThan(0);
    expect(Array.isArray(config.server.llm.usages.agent.attempts)).toBe(true);
  });

  it("SQLite 相对路径锚定到 config.yaml 所在目录（file: 绝对化）", async () => {
    const dir = createFixtureDir();
    const config = await loadStaticConfig({ configPath: path.join(dir, "config.yaml") });
    if (config.server.databaseUrl.startsWith("file:")) {
      const filePath = config.server.databaseUrl.slice("file:".length);
      expect(path.isAbsolute(filePath)).toBe(true);
      expect(filePath.startsWith(dir)).toBe(true);
    }
  });

  it("非法配置值抛 ConfigError（含出错字段路径）", async () => {
    const dir = createFixtureDir(text =>
      text.replace(/timeoutMs:\s*\d+/, 'timeoutMs: "not-a-number"'),
    );
    await expect(loadStaticConfig({ configPath: path.join(dir, "config.yaml") })).rejects.toThrow(
      "配置值不合法",
    );
  });
});
