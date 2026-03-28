import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DefaultConfigManager } from "../../src/config/config.impl.manager.js";
import { BizError } from "../../src/common/errors/biz-error.js";
import { loadStaticConfig } from "../../src/config/config.loader.js";

const tempDirs: string[] = [];

async function writeConfigFile(content: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kagami-config-"));
  tempDirs.push(dir);

  const configPath = path.join(dir, "config.yaml");
  await writeFile(configPath, content, "utf8");
  return configPath;
}

function buildConfigYaml(napcatBlock: string, extraServerBlock = ""): string {
  return `
server:
  databaseUrl: postgresql://user:password@localhost:5432/kagami
${extraServerBlock ? `${indent(extraServerBlock, 2)}\n` : ""}  napcat:
${indent(napcatBlock, 4)}
  agent:
    portalSleepMs: 30000
    contextCompactionThreshold: 60
  llm:
    timeoutMs: 15000
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
      webSearchAgent:
        attempts:
          - provider: openai
            model: gpt-4o-mini
  rag:
    embedding:
      apiKey: gemini-key
  tavily:
    apiKey: tavily-key
  bot:
    qq: "10001"
`;
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
      buildConfigYaml(
        `
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
  - "234567"
startupContextRecentMessageCount: 0
`,
        "port: 3100\n",
      ),
    );

    const config = await loadStaticConfig({ configPath });
    const manager = new DefaultConfigManager({
      config,
    });

    await expect(manager.config()).resolves.toMatchObject({
      server: {
        databaseUrl: "postgresql://user:password@localhost:5432/kagami",
        port: 3100,
        agent: {
          portalSleepMs: 30000,
          contextCompactionThreshold: 60,
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
      name: "BizError",
      message: "读取配置文件失败",
      meta: {
        key: configPath,
        reason: "CONFIG_READ_FAILED",
      },
    } satisfies Partial<BizError>);
  });

  it("should reject invalid config values", async () => {
    const configPath = await writeConfigFile(
      buildConfigYaml(
        `
wsUrl: wss://example.com/napcat
reconnectMs: 3000
requestTimeoutMs: 10000
listenGroupIds:
  - "123456"
`,
        "port: not-a-number\n",
      ),
    );

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "BizError",
      message: "配置值不合法",
      meta: {
        key: "server.port",
        reason: "CONFIG_INVALID",
      },
    } satisfies Partial<BizError>);
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
      name: "BizError",
      message: "配置值不合法",
      meta: {
        key: "server.napcat.listenGroupIds.0",
        reason: "CONFIG_INVALID",
      },
    } satisfies Partial<BizError>);
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
      name: "BizError",
      message: "配置值不合法",
      meta: {
        key: "server.napcat.listenGroupId",
        reason: "CONFIG_INVALID",
      },
    } satisfies Partial<BizError>);
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

  it("should default portal sleep ms to 30000", async () => {
    const configPath = await writeConfigFile(`
server:
  databaseUrl: postgresql://user:password@localhost:5432/kagami
  napcat:
    wsUrl: wss://example.com/napcat
    reconnectMs: 3000
    requestTimeoutMs: 10000
    listenGroupIds:
      - "123456"
  llm:
    timeoutMs: 15000
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
      webSearchAgent:
        attempts:
          - provider: openai
            model: gpt-4o-mini
  rag:
    embedding:
      apiKey: gemini-key
  tavily:
    apiKey: tavily-key
  bot:
    qq: "10001"
`);

    const config = await loadStaticConfig({ configPath });

    expect(config.server.agent.portalSleepMs).toBe(30_000);
    expect(config.server.agent.contextCompactionThreshold).toBe(60);
  });

  it("should allow overriding context compaction threshold", async () => {
    const configPath = await writeConfigFile(`
server:
  databaseUrl: postgresql://user:password@localhost:5432/kagami
  agent:
    portalSleepMs: 30000
    contextCompactionThreshold: 80
  napcat:
    wsUrl: wss://example.com/napcat
    reconnectMs: 3000
    requestTimeoutMs: 10000
    listenGroupIds:
      - "123456"
  llm:
    timeoutMs: 15000
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
      webSearchAgent:
        attempts:
          - provider: openai
            model: gpt-4o-mini
  rag:
    embedding:
      apiKey: gemini-key
  tavily:
    apiKey: tavily-key
  bot:
    qq: "10001"
`);

    const config = await loadStaticConfig({ configPath });

    expect(config.server.agent.contextCompactionThreshold).toBe(80);
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
      name: "BizError",
      message: "配置值不合法",
      meta: {
        key: "server.napcat.startupContextRecentMessageCount",
        reason: "CONFIG_INVALID",
      },
    } satisfies Partial<BizError>);
  });
});
