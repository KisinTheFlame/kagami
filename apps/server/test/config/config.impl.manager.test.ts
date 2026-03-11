import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigManagerError, DefaultConfigManager } from "../../src/config/config.impl.manager.js";
import { loadStaticConfig } from "../../src/config/config.loader.js";

const tempDirs: string[] = [];

async function writeConfigFile(content: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kagami-config-"));
  tempDirs.push(dir);

  const configPath = path.join(dir, "config.yaml");
  await writeFile(configPath, content, "utf8");
  return configPath;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe("Static config loading", () => {
  it("should parse config.yaml and map it to runtime configs", async () => {
    const configPath = await writeConfigFile(`
server:
  databaseUrl: postgresql://user:password@localhost:5432/kagami
  port: 3100
  napcat:
    wsUrl: wss://example.com/napcat
    reconnectMs: 3000
    requestTimeoutMs: 10000
    listenGroupId: "123456"
  llm:
    timeoutMs: 15000
    providers:
      deepseek:
        apiKey: ""
      openai:
        apiKey: openai-key
    usages:
      agent:
        attempts:
          - provider: openai
            model: gpt-4o-mini
            times: 2
      ragQueryPlanner:
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

    const manager = new DefaultConfigManager({
      config: await loadStaticConfig({ configPath }),
    });

    await expect(manager.getBootConfig()).resolves.toEqual({
      databaseUrl: "postgresql://user:password@localhost:5432/kagami",
      port: 3100,
      napcat: {
        wsUrl: "wss://example.com/napcat",
        reconnectMs: 3000,
        requestTimeoutMs: 10000,
        listenGroupId: "123456",
      },
    });

    await expect(manager.getLlmRuntimeConfig()).resolves.toEqual({
      timeoutMs: 15000,
      deepseek: {
        apiKey: undefined,
        baseUrl: "https://api.deepseek.com",
        chatModel: "deepseek-chat",
        timeoutMs: 15000,
      },
      openai: {
        apiKey: "openai-key",
        baseUrl: "https://api.openai.com/v1",
        chatModel: "gpt-4o-mini",
        timeoutMs: 15000,
      },
      openaiCodex: {
        authFilePath: "~/.codex/auth.json",
        baseUrl: "https://chatgpt.com/backend-api/codex/responses",
        chatModel: "gpt-5.3-codex",
        refreshLeewayMs: 60_000,
        timeoutMs: 15000,
      },
      usages: {
        agent: {
          attempts: [
            {
              provider: "openai",
              model: "gpt-4o-mini",
              times: 2,
            },
          ],
        },
        ragQueryPlanner: {
          attempts: [
            {
              provider: "openai",
              model: "gpt-4o-mini",
              times: 1,
            },
          ],
        },
      },
    });

    await expect(manager.getRagRuntimeConfig()).resolves.toEqual({
      embedding: {
        provider: "google",
        apiKey: "gemini-key",
        baseUrl: "https://generativelanguage.googleapis.com",
        model: "gemini-embedding-001",
        outputDimensionality: 768,
      },
      retrieval: {
        topK: 3,
      },
    });

    await expect(manager.getTavilyConfig()).resolves.toEqual({
      apiKey: "tavily-key",
    });
    await expect(manager.getBotProfileConfig()).resolves.toEqual({
      botQQ: "10001",
    });
  });

  it("should fail fast when config.yaml is missing", async () => {
    const configPath = path.join(os.tmpdir(), `missing-${Date.now()}.yml`);

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigManagerError",
      code: "CONFIG_READ_FAILED",
      key: configPath,
    } satisfies Partial<ConfigManagerError>);
  });

  it("should reject invalid config values", async () => {
    const configPath = await writeConfigFile(`
server:
  databaseUrl: postgresql://user:password@localhost:5432/kagami
  port: not-a-number
  napcat:
    wsUrl: wss://example.com/napcat
    reconnectMs: 3000
    requestTimeoutMs: 10000
    listenGroupId: "123456"
  llm:
    providers:
      deepseek: {}
      openai: {}
    usages:
      agent:
        attempts:
          - provider: deepseek
            model: deepseek-chat
      ragQueryPlanner:
        attempts:
          - provider: deepseek
            model: deepseek-chat
  rag:
    embedding:
      apiKey: gemini-key
  tavily: {}
  bot:
    qq: "10001"
`);

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigManagerError",
      code: "CONFIG_INVALID",
      key: "server.port",
    } satisfies Partial<ConfigManagerError>);
  });

  it("should fail when required config is missing", async () => {
    const configPath = await writeConfigFile(`
server:
  port: 3000
  napcat:
    wsUrl: wss://example.com/napcat
    reconnectMs: 3000
    requestTimeoutMs: 10000
    listenGroupId: "123456"
  llm:
    providers:
      deepseek: {}
      openai: {}
    usages:
      agent:
        attempts:
          - provider: deepseek
            model: deepseek-chat
      ragQueryPlanner:
        attempts:
          - provider: deepseek
            model: deepseek-chat
  rag:
    embedding:
      apiKey: gemini-key
  tavily: {}
  bot:
    qq: "10001"
`);

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigManagerError",
      code: "CONFIG_INVALID",
      key: "server.databaseUrl",
    } satisfies Partial<ConfigManagerError>);
  });

  it("should tolerate empty OpenAI config placeholders", async () => {
    const configPath = await writeConfigFile(`
server:
  databaseUrl: postgresql://user:password@localhost:5432/kagami
  napcat:
    wsUrl: wss://example.com/napcat
    reconnectMs: 3000
    requestTimeoutMs: 10000
    listenGroupId: "123456"
  llm:
    providers:
      deepseek: {}
      openai:
        apiKey: "   "
        baseUrl: ""
        chatModel: " "
    usages:
      agent:
        attempts:
          - provider: deepseek
            model: deepseek-chat
      ragQueryPlanner:
        attempts:
          - provider: deepseek
            model: deepseek-chat
  rag:
    embedding:
      apiKey: gemini-key
  tavily: {}
  bot:
    qq: "10001"
`);

    const manager = new DefaultConfigManager({
      config: await loadStaticConfig({ configPath }),
    });

    await expect(manager.getLlmRuntimeConfig()).resolves.toMatchObject({
      timeoutMs: 45_000,
      openai: {
        apiKey: undefined,
        baseUrl: "https://api.openai.com/v1",
        chatModel: "gpt-4o-mini",
      },
      openaiCodex: {
        authFilePath: "~/.codex/auth.json",
        baseUrl: "https://chatgpt.com/backend-api/codex/responses",
        chatModel: "gpt-5.3-codex",
        refreshLeewayMs: 60_000,
      },
      usages: {
        agent: {
          attempts: [
            {
              provider: "deepseek",
              model: "deepseek-chat",
              times: 1,
            },
          ],
        },
        ragQueryPlanner: {
          attempts: [
            {
              provider: "deepseek",
              model: "deepseek-chat",
              times: 1,
            },
          ],
        },
      },
    });
  });

  it("should default server port to 20003", async () => {
    const configPath = await writeConfigFile(`
server:
  databaseUrl: postgresql://user:password@localhost:5432/kagami
  napcat:
    wsUrl: ws://localhost:6099
    reconnectMs: 3000
    requestTimeoutMs: 10000
    listenGroupId: "123456"
  llm:
    providers:
      deepseek: {}
      openai: {}
    usages:
      agent:
        attempts:
          - provider: deepseek
            model: deepseek-chat
      ragQueryPlanner:
        attempts:
          - provider: deepseek
            model: deepseek-chat
  rag:
    embedding:
      apiKey: gemini-key
  tavily: {}
  bot:
    qq: "10001"
`);

    const manager = new DefaultConfigManager({
      config: await loadStaticConfig({ configPath }),
    });

    await expect(manager.getBootConfig()).resolves.toMatchObject({
      port: 20003,
    });
  });

  it("should fail when rag embedding apiKey is missing", async () => {
    const configPath = await writeConfigFile(`
server:
  databaseUrl: postgresql://user:password@localhost:5432/kagami
  napcat:
    wsUrl: wss://example.com/napcat
    reconnectMs: 3000
    requestTimeoutMs: 10000
    listenGroupId: "123456"
  llm:
    providers:
      deepseek: {}
      openai: {}
    usages:
      agent:
        attempts:
          - provider: deepseek
            model: deepseek-chat
      ragQueryPlanner:
        attempts:
          - provider: deepseek
            model: deepseek-chat
  rag:
    embedding: {}
  tavily: {}
  bot:
    qq: "10001"
`);

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigManagerError",
      code: "CONFIG_INVALID",
      key: "server.rag.embedding.apiKey",
    } satisfies Partial<ConfigManagerError>);
  });

  it("should reject legacy llm usage config without attempts", async () => {
    const configPath = await writeConfigFile(`
server:
  databaseUrl: postgresql://user:password@localhost:5432/kagami
  napcat:
    wsUrl: wss://example.com/napcat
    reconnectMs: 3000
    requestTimeoutMs: 10000
    listenGroupId: "123456"
  llm:
    providers:
      deepseek: {}
      openai: {}
    usages:
      agent:
        provider: deepseek
        model: deepseek-chat
      ragQueryPlanner:
        attempts:
          - provider: deepseek
            model: deepseek-chat
  rag:
    embedding:
      apiKey: gemini-key
  tavily: {}
  bot:
    qq: "10001"
`);

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigManagerError",
      code: "CONFIG_INVALID",
      key: "server.llm.usages.agent.attempts",
    } satisfies Partial<ConfigManagerError>);
  });

  it("should reject llm usage config with empty attempts", async () => {
    const configPath = await writeConfigFile(`
server:
  databaseUrl: postgresql://user:password@localhost:5432/kagami
  napcat:
    wsUrl: wss://example.com/napcat
    reconnectMs: 3000
    requestTimeoutMs: 10000
    listenGroupId: "123456"
  llm:
    providers:
      deepseek: {}
      openai: {}
    usages:
      agent:
        attempts: []
      ragQueryPlanner:
        attempts:
          - provider: deepseek
            model: deepseek-chat
  rag:
    embedding:
      apiKey: gemini-key
  tavily: {}
  bot:
    qq: "10001"
`);

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigManagerError",
      code: "CONFIG_INVALID",
      key: "server.llm.usages.agent.attempts",
    } satisfies Partial<ConfigManagerError>);
  });

  it("should reject llm usage config with non-positive times", async () => {
    const configPath = await writeConfigFile(`
server:
  databaseUrl: postgresql://user:password@localhost:5432/kagami
  napcat:
    wsUrl: wss://example.com/napcat
    reconnectMs: 3000
    requestTimeoutMs: 10000
    listenGroupId: "123456"
  llm:
    providers:
      deepseek: {}
      openai: {}
    usages:
      agent:
        attempts:
          - provider: deepseek
            model: deepseek-chat
            times: 0
      ragQueryPlanner:
        attempts:
          - provider: deepseek
            model: deepseek-chat
  rag:
    embedding:
      apiKey: gemini-key
  tavily: {}
  bot:
    qq: "10001"
`);

    await expect(loadStaticConfig({ configPath })).rejects.toMatchObject({
      name: "ConfigManagerError",
      code: "CONFIG_INVALID",
      key: "server.llm.usages.agent.attempts.0.times",
    } satisfies Partial<ConfigManagerError>);
  });
});
