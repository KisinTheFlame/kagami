import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError } from "@kagami/config/errors";
import { DefaultConfigManager } from "@kagami/kernel/config/config.impl.manager";
import { loadStaticConfig } from "@kagami/kernel/config/config.loader";

const tempDirs: string[] = [];

async function makeConfigDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kagami-config-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * 写出 config.yaml + 一个兄弟 config.secret.yaml。这些用例把（可放隐私的）值内联在
 * config.yaml 里测 loader 的解析/校验，secret 文件默认为空对象 `{}`——deepMerge(base, {})
 * = base，故合并对既有断言透明。secretContent 可覆盖以测合并/白名单。
 */
async function writeConfigFile(content: string, secretContent = "{}\n"): Promise<string> {
  const dir = await makeConfigDir();
  const configPath = path.join(dir, "config.yaml");
  await writeFile(configPath, content, "utf8");
  await writeFile(path.join(dir, "config.secret.yaml"), secretContent, "utf8");
  return configPath;
}

/** 只写 config.yaml、故意不写 config.secret.yaml，用于测缺文件响亮失败。 */
async function writeConfigFileWithoutSecret(content: string): Promise<string> {
  const dir = await makeConfigDir();
  const configPath = path.join(dir, "config.yaml");
  await writeFile(configPath, content, "utf8");
  return configPath;
}

function buildConfigYaml(napcatBlock: string, extraServerBlock = ""): string {
  return `
services:
  agent: { host: localhost, port: 20003 }
  console: { host: localhost, port: 20006 }
  gateway: { host: localhost, port: 20004 }
  oss: { host: 127.0.0.1, port: 20005 }
  browser: { host: 127.0.0.1, port: 20007 }
  llm: { host: 127.0.0.1, port: 20009 }
  metric: { host: 127.0.0.1, port: 20010 }
  spire: { host: 127.0.0.1, port: 20011 }
  napcat: { host: 127.0.0.1, port: 20013 }
  pixel: { host: 127.0.0.1, port: 20012 }
  gba: { host: 127.0.0.1, port: 20015 }
  scheduler: { host: 127.0.0.1, port: 20014, databaseUrl: "file::memory:" }
server:
  databaseUrl: "file::memory:"
${extraServerBlock ? `${indent(extraServerBlock, 2)}\n` : ""}  napcat:
${indent(napcatBlock, 4)}
  agent:
    contextCompactionTotalTokenThreshold: 150000
  llm:
    timeoutMs: 15000
    embedding:
      apiKey: gemini-key
    codexAuth:
      publicBaseUrl: http://localhost:20004
    claudeCodeAuth:
      publicBaseUrl: http://localhost:20004
    providers:
      deepseek:
        apiKey: ""
        models:
          - deepseek-chat
      openai:
        apiKey: openai-key
        models:
          - gpt-4o-mini
      openaiCodex:
        models:
          - gpt-5.3-codex
      claudeCode:
        models:
          - claude-sonnet-4-20250514
        keepAliveReplayIntervalMinutes: 30
    usages:
      agent:
        attempts:
          - provider: openai
            model: gpt-4o-mini
            times: 2
      contextSummarizer:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      vision:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      todoSuggestionAgent:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      innerVoice:
        attempts:
          - provider: openai
            model: gpt-4o-mini
  bot:
    qq: "10001"
    creator:
      name: 创造者
      qq: "10000"
`;
}

function useTeiEmbeddingConfig(content: string, extraLines = ""): string {
  const teiBlock = [
    "    embedding:",
    "      provider: tei-embedding-gemma",
    "      baseUrl: http://127.0.0.1:20008",
    "      model: google/embeddinggemma-300m",
    "      outputDimensionality: 768",
    extraLines,
  ]
    .filter(Boolean)
    .join("\n");

  return content.replace(
    `    embedding:
      apiKey: gemini-key`,
    teiBlock,
  );
}

function indent(content: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return content
    .trim()
    .split("\n")
    .map(line => `${prefix}${line}`)
    .join("\n");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe("Static config loading", () => {
  it("should parse config.yaml and expose the normalized multi-group config", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
  - "234567"
startupContextRecentMessageCount: 0
`),
    );

    const config = await loadStaticConfig({ configPath });
    const manager = new DefaultConfigManager({
      config,
    });

    await expect(manager.config()).resolves.toMatchObject({
      services: {
        agent: { host: "localhost", port: 20003 },
        console: { host: "localhost", port: 20006 },
        gateway: { host: "localhost", port: 20004 },
        oss: { host: "127.0.0.1", port: 20005 },
        browser: { host: "127.0.0.1", port: 20007 },
        llm: { host: "127.0.0.1", port: 20009 },
        metric: { host: "127.0.0.1", port: 20010 },
      },
      server: {
        databaseUrl: "file::memory:",
        agent: {
          contextCompactionTotalTokenThreshold: 150_000,
          llmRetryBackoffMs: 30_000,
          waitToolMaxWaitMs: 600_000,
        },
        napcat: {
          wsUrl: "wss://example.com/napcat",
          reconnectMs: 3000,
          requestTimeoutMs: 10000,
          listenGroupIds: ["123456", "234567"],
          startupContextRecentMessageCount: 0,
        },
        llm: {
          timeoutMs: 15000,
        },
      },
    });
    await expect(manager.config()).resolves.toBe(config);
  });

  it("should fail fast when config.yaml is missing", async () => {
    const configPath = path.join(os.tmpdir(), `missing-${Date.now()}.yml`);

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigError",
      message: "读取配置文件失败",
      meta: {
        key: configPath,
        reason: "CONFIG_READ_FAILED",
      },
    } satisfies Partial<ConfigError>);
  });

  it("should reject config missing the required todoSuggestionAgent usage (fail loud)", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`).replace(
        `      todoSuggestionAgent:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      innerVoice:
        attempts:
          - provider: openai
            model: gpt-4o-mini
`,
        "",
      ),
    );

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigError",
      message: "配置值不合法",
      meta: {
        key: expect.stringContaining("todoSuggestionAgent"),
        reason: "CONFIG_INVALID",
      },
    });
  });

  it("should reject invalid config values", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`).replace(
        "agent: { host: localhost, port: 20003 }",
        "agent: { host: localhost, port: not-a-number }",
      ),
    );

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigError",
      message: "配置值不合法",
      meta: {
        key: "services.agent.port",
        reason: "CONFIG_INVALID",
      },
    } satisfies Partial<ConfigError>);
  });

  it("should reject missing creator config", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(
        `
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`,
      ).replace(
        `  bot:
    qq: "10001"
    creator:
      name: 创造者
      qq: "10000"
`,
        `  bot:
    qq: "10001"
`,
      ),
    );

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigError",
      message: "配置值不合法",
      meta: {
        key: "server.bot.creator",
        reason: "CONFIG_INVALID",
      },
    } satisfies Partial<ConfigError>);
  });

  it("should reject missing creator name", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`).replace("      name: 创造者\n", ""),
    );

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigError",
      message: "配置值不合法",
      meta: {
        key: "server.bot.creator.name",
        reason: "CONFIG_INVALID",
      },
    } satisfies Partial<ConfigError>);
  });

  it("should reject missing creator qq", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`).replace('      qq: "10000"\n', ""),
    );

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigError",
      message: "配置值不合法",
      meta: {
        key: "server.bot.creator.qq",
        reason: "CONFIG_INVALID",
      },
    } satisfies Partial<ConfigError>);
  });

  it("should reject blank listen group id", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - ""
`),
    );

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigError",
      message: "配置值不合法",
      meta: {
        key: "server.napcat.listenGroupIds.0",
        reason: "CONFIG_INVALID",
      },
    } satisfies Partial<ConfigError>);
  });

  it("should reject legacy listenGroupId config", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupId: "123456"
`),
    );

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigError",
      message: "配置值不合法",
      meta: {
        key: "server.napcat.listenGroupId",
        reason: "CONFIG_INVALID",
      },
    } satisfies Partial<ConfigError>);
  });

  it("should default startup context recent message count to 40", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`),
    );

    const config = await loadStaticConfig({ configPath });

    expect(config.server.napcat.startupContextRecentMessageCount).toBe(40);
  });

  it("should default context compaction threshold to 60", async () => {
    const configPath = await writeConfigFile(`
services:
  agent: { host: localhost, port: 20003 }
  console: { host: localhost, port: 20006 }
  gateway: { host: localhost, port: 20004 }
  oss: { host: 127.0.0.1, port: 20005 }
  browser: { host: 127.0.0.1, port: 20007 }
  llm: { host: 127.0.0.1, port: 20009 }
  metric: { host: 127.0.0.1, port: 20010 }
  spire: { host: 127.0.0.1, port: 20011 }
  napcat: { host: 127.0.0.1, port: 20013 }
  pixel: { host: 127.0.0.1, port: 20012 }
  gba: { host: 127.0.0.1, port: 20015 }
  scheduler: { host: 127.0.0.1, port: 20014, databaseUrl: "file::memory:" }
server:
  databaseUrl: "file::memory:"
  agent: {}
  napcat:
    wsUrl: wss://example.com/napcat
    reconnectMs: 3000
    requestTimeoutMs: 10000
    listenGroupIds:
      - "123456"
  llm:
    timeoutMs: 15000
    embedding:
      apiKey: gemini-key
    codexAuth:
      publicBaseUrl: http://localhost:20004
    claudeCodeAuth:
      publicBaseUrl: http://localhost:20004
    providers:
      deepseek:
        apiKey: ""
        models:
          - deepseek-chat
      openai:
        apiKey: openai-key
        models:
          - gpt-4o-mini
      openaiCodex:
        models:
          - gpt-5.3-codex
      claudeCode:
        models:
          - claude-sonnet-4-20250514
    usages:
      agent:
        attempts:
          - provider: openai
            model: gpt-4o-mini
            times: 2
      contextSummarizer:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      vision:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      todoSuggestionAgent:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      innerVoice:
        attempts:
          - provider: openai
            model: gpt-4o-mini
  bot:
    qq: "10001"
    creator:
      name: 创造者
      qq: "10000"
`);

    const config = await loadStaticConfig({ configPath });

    expect(config.server.agent.contextCompactionTotalTokenThreshold).toBe(150_000);
    expect(config.server.agent.llmRetryBackoffMs).toBe(30_000);
    expect(config.server.agent.waitToolMaxWaitMs).toBe(600_000);
    expect(config.server.agent.asyncTask.maxTaskDurationMs).toBe(600_000);
  });

  it("should default claude code keep alive replay interval minutes to 30", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`).replace(
        `      claudeCode:
        models:
          - claude-sonnet-4-20250514
        keepAliveReplayIntervalMinutes: 30`,
        `      claudeCode:
        models:
          - claude-sonnet-4-20250514`,
      ),
    );

    const config = await loadStaticConfig({ configPath });

    expect(config.server.llm.providers.claudeCode.keepAliveReplayIntervalMinutes).toBe(30);
  });

  it("should allow overriding claude code keep alive replay interval minutes", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`).replace(
        "        keepAliveReplayIntervalMinutes: 30",
        "        keepAliveReplayIntervalMinutes: 45",
      ),
    );

    const config = await loadStaticConfig({ configPath });

    expect(config.server.llm.providers.claudeCode.keepAliveReplayIntervalMinutes).toBe(45);
  });

  it("should default codex auth refresh check interval ms to 60000", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`),
    );

    const config = await loadStaticConfig({ configPath });

    expect(config.server.llm.codexAuth.refreshCheckIntervalMs).toBe(60_000);
  });

  it("should allow overriding codex auth refresh check interval ms", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`).replace(
        `    codexAuth:
      publicBaseUrl: http://localhost:20004`,
        `    codexAuth:
      publicBaseUrl: http://localhost:20004
      refreshCheckIntervalMs: 90000`,
      ),
    );

    const config = await loadStaticConfig({ configPath });

    expect(config.server.llm.codexAuth.refreshCheckIntervalMs).toBe(90_000);
  });

  it("should default claude code auth refresh check interval ms to 300000", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`),
    );

    const config = await loadStaticConfig({ configPath });

    expect(config.server.llm.claudeCodeAuth.refreshCheckIntervalMs).toBe(300_000);
  });

  it("should parse TEI Embedding Gemma config", async () => {
    const configPath = await writeConfigFile(
      useTeiEmbeddingConfig(
        buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`),
      ),
    );

    const config = await loadStaticConfig({ configPath });

    expect(config.server.llm.embedding).toEqual({
      provider: "tei-embedding-gemma",
      baseUrl: "http://127.0.0.1:20008",
      model: "google/embeddinggemma-300m",
      outputDimensionality: 768,
    });
  });

  it("should reject TEI Embedding Gemma config without baseUrl", async () => {
    const configPath = await writeConfigFile(
      useTeiEmbeddingConfig(
        buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`),
      ).replace("      baseUrl: http://127.0.0.1:20008\n", ""),
    );

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigError",
      message: "配置值不合法",
      meta: {
        key: "server.llm.embedding.baseUrl",
        reason: "CONFIG_INVALID",
      },
    } satisfies Partial<ConfigError>);
  });

  it("should reject TEI Embedding Gemma config without model", async () => {
    const configPath = await writeConfigFile(
      useTeiEmbeddingConfig(
        buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`),
      ).replace("      model: google/embeddinggemma-300m\n", ""),
    );

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigError",
      message: "配置值不合法",
      meta: {
        key: "server.llm.embedding.model",
        reason: "CONFIG_INVALID",
      },
    } satisfies Partial<ConfigError>);
  });

  it("should reject TEI Embedding Gemma config without output dimensionality", async () => {
    const configPath = await writeConfigFile(
      useTeiEmbeddingConfig(
        buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`),
      ).replace("      outputDimensionality: 768\n", ""),
    );

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigError",
      message: "配置值不合法",
      meta: {
        key: "server.llm.embedding.outputDimensionality",
        reason: "CONFIG_INVALID",
      },
    } satisfies Partial<ConfigError>);
  });

  it("should allow overriding claude code auth refresh check interval ms", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`).replace(
        `    claudeCodeAuth:
      publicBaseUrl: http://localhost:20004`,
        `    claudeCodeAuth:
      publicBaseUrl: http://localhost:20004
      refreshCheckIntervalMs: 120000`,
      ),
    );

    const config = await loadStaticConfig({ configPath });

    expect(config.server.llm.claudeCodeAuth.refreshCheckIntervalMs).toBe(120_000);
  });

  it("should reject non-positive claude code keep alive replay interval minutes", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`).replace(
        "        keepAliveReplayIntervalMinutes: 30",
        "        keepAliveReplayIntervalMinutes: 0",
      ),
    );

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigError",
      message: "配置值不合法",
      meta: {
        key: "server.llm.providers.claudeCode.keepAliveReplayIntervalMinutes",
        reason: "CONFIG_INVALID",
      },
    } satisfies Partial<ConfigError>);
  });

  it("should allow overriding context compaction total token threshold", async () => {
    const configPath = await writeConfigFile(`
services:
  agent: { host: localhost, port: 20003 }
  console: { host: localhost, port: 20006 }
  gateway: { host: localhost, port: 20004 }
  oss: { host: 127.0.0.1, port: 20005 }
  browser: { host: 127.0.0.1, port: 20007 }
  llm: { host: 127.0.0.1, port: 20009 }
  metric: { host: 127.0.0.1, port: 20010 }
  spire: { host: 127.0.0.1, port: 20011 }
  napcat: { host: 127.0.0.1, port: 20013 }
  pixel: { host: 127.0.0.1, port: 20012 }
  gba: { host: 127.0.0.1, port: 20015 }
  scheduler: { host: 127.0.0.1, port: 20014, databaseUrl: "file::memory:" }
server:
  databaseUrl: "file::memory:"
  agent:
    contextCompactionTotalTokenThreshold: 80000
  napcat:
    wsUrl: wss://example.com/napcat
    reconnectMs: 3000
    requestTimeoutMs: 10000
    listenGroupIds:
      - "123456"
  llm:
    timeoutMs: 15000
    embedding:
      apiKey: gemini-key
    codexAuth:
      publicBaseUrl: http://localhost:20004
    claudeCodeAuth:
      publicBaseUrl: http://localhost:20004
    providers:
      deepseek:
        apiKey: ""
        models:
          - deepseek-chat
      openai:
        apiKey: openai-key
        models:
          - gpt-4o-mini
      openaiCodex:
        models:
          - gpt-5.3-codex
      claudeCode:
        models:
          - claude-sonnet-4-20250514
    usages:
      agent:
        attempts:
          - provider: openai
            model: gpt-4o-mini
            times: 2
      contextSummarizer:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      vision:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      todoSuggestionAgent:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      innerVoice:
        attempts:
          - provider: openai
            model: gpt-4o-mini
  bot:
    qq: "10001"
    creator:
      name: 创造者
      qq: "10000"
`);

    const config = await loadStaticConfig({ configPath });

    expect(config.server.agent.contextCompactionTotalTokenThreshold).toBe(80_000);
    expect(config.server.agent.llmRetryBackoffMs).toBe(30_000);
    expect(config.server.agent.waitToolMaxWaitMs).toBe(600_000);
  });

  it("should reject the legacy context compaction threshold field", async () => {
    const configPath = await writeConfigFile(`
services:
  agent: { host: localhost, port: 20003 }
  console: { host: localhost, port: 20006 }
  gateway: { host: localhost, port: 20004 }
  oss: { host: 127.0.0.1, port: 20005 }
  browser: { host: 127.0.0.1, port: 20007 }
  llm: { host: 127.0.0.1, port: 20009 }
  metric: { host: 127.0.0.1, port: 20010 }
  spire: { host: 127.0.0.1, port: 20011 }
  napcat: { host: 127.0.0.1, port: 20013 }
  pixel: { host: 127.0.0.1, port: 20012 }
  gba: { host: 127.0.0.1, port: 20015 }
  scheduler: { host: 127.0.0.1, port: 20014, databaseUrl: "file::memory:" }
server:
  databaseUrl: "file::memory:"
  agent:
    contextCompactionThreshold: 80
  napcat:
    wsUrl: wss://example.com/napcat
    reconnectMs: 3000
    requestTimeoutMs: 10000
    listenGroupIds:
      - "123456"
  llm:
    timeoutMs: 15000
    embedding:
      apiKey: gemini-key
    codexAuth:
      publicBaseUrl: http://localhost:20004
    claudeCodeAuth:
      publicBaseUrl: http://localhost:20004
    providers:
      deepseek:
        apiKey: ""
        models:
          - deepseek-chat
      openai:
        apiKey: openai-key
        models:
          - gpt-4o-mini
      openaiCodex:
        models:
          - gpt-5.3-codex
      claudeCode:
        models:
          - claude-sonnet-4-20250514
    usages:
      agent:
        attempts:
          - provider: openai
            model: gpt-4o-mini
            times: 2
      contextSummarizer:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      vision:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      todoSuggestionAgent:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      innerVoice:
        attempts:
          - provider: openai
            model: gpt-4o-mini
  bot:
    qq: "10001"
    creator:
      name: 创造者
      qq: "10000"
`);

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigError",
      message: "配置值不合法",
      meta: {
        key: "server.agent.contextCompactionThreshold",
        reason: "CONFIG_INVALID",
      },
    } satisfies Partial<ConfigError>);
  });

  it("should allow overriding llm retry backoff ms", async () => {
    const configPath = await writeConfigFile(`
services:
  agent: { host: localhost, port: 20003 }
  console: { host: localhost, port: 20006 }
  gateway: { host: localhost, port: 20004 }
  oss: { host: 127.0.0.1, port: 20005 }
  browser: { host: 127.0.0.1, port: 20007 }
  llm: { host: 127.0.0.1, port: 20009 }
  metric: { host: 127.0.0.1, port: 20010 }
  spire: { host: 127.0.0.1, port: 20011 }
  napcat: { host: 127.0.0.1, port: 20013 }
  pixel: { host: 127.0.0.1, port: 20012 }
  gba: { host: 127.0.0.1, port: 20015 }
  scheduler: { host: 127.0.0.1, port: 20014, databaseUrl: "file::memory:" }
server:
  databaseUrl: "file::memory:"
  agent:
    llmRetryBackoffMs: 45000
  napcat:
    wsUrl: wss://example.com/napcat
    reconnectMs: 3000
    requestTimeoutMs: 10000
    listenGroupIds:
      - "123456"
  llm:
    timeoutMs: 15000
    embedding:
      apiKey: gemini-key
    codexAuth:
      publicBaseUrl: http://localhost:20004
    claudeCodeAuth:
      publicBaseUrl: http://localhost:20004
    providers:
      deepseek:
        apiKey: ""
        models:
          - deepseek-chat
      openai:
        apiKey: openai-key
        models:
          - gpt-4o-mini
      openaiCodex:
        models:
          - gpt-5.3-codex
      claudeCode:
        models:
          - claude-sonnet-4-20250514
    usages:
      agent:
        attempts:
          - provider: openai
            model: gpt-4o-mini
            times: 2
      contextSummarizer:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      vision:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      todoSuggestionAgent:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      innerVoice:
        attempts:
          - provider: openai
            model: gpt-4o-mini
  bot:
    qq: "10001"
    creator:
      name: 创造者
      qq: "10000"
`);

    const config = await loadStaticConfig({ configPath });

    expect(config.server.agent.llmRetryBackoffMs).toBe(45_000);
    expect(config.server.agent.waitToolMaxWaitMs).toBe(600_000);
  });

  it("should allow overriding wait tool max wait ms", async () => {
    const configPath = await writeConfigFile(`
services:
  agent: { host: localhost, port: 20003 }
  console: { host: localhost, port: 20006 }
  gateway: { host: localhost, port: 20004 }
  oss: { host: 127.0.0.1, port: 20005 }
  browser: { host: 127.0.0.1, port: 20007 }
  llm: { host: 127.0.0.1, port: 20009 }
  metric: { host: 127.0.0.1, port: 20010 }
  spire: { host: 127.0.0.1, port: 20011 }
  napcat: { host: 127.0.0.1, port: 20013 }
  pixel: { host: 127.0.0.1, port: 20012 }
  gba: { host: 127.0.0.1, port: 20015 }
  scheduler: { host: 127.0.0.1, port: 20014, databaseUrl: "file::memory:" }
server:
  databaseUrl: "file::memory:"
  agent:
    waitToolMaxWaitMs: 120000
    asyncTask:
      maxTaskDurationMs: 120000
  napcat:
    wsUrl: wss://example.com/napcat
    reconnectMs: 3000
    requestTimeoutMs: 10000
    listenGroupIds:
      - "123456"
  llm:
    timeoutMs: 15000
    embedding:
      apiKey: gemini-key
    codexAuth:
      publicBaseUrl: http://localhost:20004
    claudeCodeAuth:
      publicBaseUrl: http://localhost:20004
    providers:
      deepseek:
        apiKey: ""
        models:
          - deepseek-chat
      openai:
        apiKey: openai-key
        models:
          - gpt-4o-mini
      openaiCodex:
        models:
          - gpt-5.3-codex
      claudeCode:
        models:
          - claude-sonnet-4-20250514
    usages:
      agent:
        attempts:
          - provider: openai
            model: gpt-4o-mini
            times: 2
      contextSummarizer:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      vision:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      todoSuggestionAgent:
        attempts:
          - provider: openai
            model: gpt-4o-mini
      innerVoice:
        attempts:
          - provider: openai
            model: gpt-4o-mini
  bot:
    qq: "10001"
    creator:
      name: 创造者
      qq: "10000"
`);

    const config = await loadStaticConfig({ configPath });

    expect(config.server.agent.waitToolMaxWaitMs).toBe(120_000);
    expect(config.server.agent.asyncTask.maxTaskDurationMs).toBe(120_000);
  });

  it("should allow zero startup context recent message count", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
startupContextRecentMessageCount: 0
`),
    );

    const config = await loadStaticConfig({ configPath });

    expect(config.server.napcat.startupContextRecentMessageCount).toBe(0);
  });

  it("should reject negative startup context recent message count", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
startupContextRecentMessageCount: -1
`),
    );

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigError",
      message: "配置值不合法",
      meta: {
        key: "server.napcat.startupContextRecentMessageCount",
        reason: "CONFIG_INVALID",
      },
    } satisfies Partial<ConfigError>);
  });

  it("should fail fast when config.secret.yaml is missing", async () => {
    const configPath = await writeConfigFileWithoutSecret(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`),
    );

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigError",
      meta: {
        reason: "CONFIG_SECRET_NOT_FOUND",
      },
    } satisfies Partial<ConfigError>);
  });

  it("lets config.secret.yaml override any key (privacy whitelist removed)", async () => {
    // 白名单护栏已移除：secret 现在可覆盖任意字段（含 services.* 这类拓扑），不再被拒绝。
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`),
      `services:
  agent:
    port: 9999
`,
    );

    const config = await loadStaticConfig({ configPath });
    expect(config.services.agent.port).toBe(9999);
  });

  it("should let config.secret.yaml override the base config", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(`
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`),
      `server:
  napcat:
    listenGroupIds:
      - "999888"
`,
    );

    const config = await loadStaticConfig({ configPath });

    expect(config.server.napcat.listenGroupIds).toEqual(["999888"]);
  });
});
