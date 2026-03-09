import { describe, expect, it, vi } from "vitest";
import { DefaultConfigManager, GAIA_CONFIG_KEYS } from "../../src/config/config.impl.manager.js";

type ConfigRecord = {
  key: string;
  value: string;
  updatedAt: string;
};

function createReadConfig(records: Record<string, string>) {
  return vi.fn(async (key: string): Promise<ConfigRecord> => {
    if (!(key in records)) {
      const error = new Error("配置不存在") as Error & { code: string; status: number };
      error.code = "HTTP_ERROR";
      error.status = 404;
      throw error;
    }

    return {
      key,
      value: records[key]!,
      updatedAt: "2026-03-09T12:00:00.000Z",
    };
  });
}

describe("DefaultConfigManager", () => {
  it("should parse boot config and runtime config values", async () => {
    const manager = new DefaultConfigManager({
      readConfig: createReadConfig({
        [GAIA_CONFIG_KEYS.databaseUrl]: "https://example.com/database",
        [GAIA_CONFIG_KEYS.port]: "3100",
        [GAIA_CONFIG_KEYS.napcatWsUrl]: "wss://example.com/napcat",
        [GAIA_CONFIG_KEYS.napcatWsReconnectMs]: "3000",
        [GAIA_CONFIG_KEYS.napcatWsRequestTimeoutMs]: "10000",
        [GAIA_CONFIG_KEYS.napcatListenGroupId]: "123456",
        [GAIA_CONFIG_KEYS.llmActiveProvider]: "openai",
        [GAIA_CONFIG_KEYS.llmTimeoutMs]: "15000",
        [GAIA_CONFIG_KEYS.openaiApiKey]: "openai-key",
        [GAIA_CONFIG_KEYS.tavilyApiKey]: "tavily-key",
        [GAIA_CONFIG_KEYS.botQQ]: "10001",
      }),
    });

    await expect(manager.getBootConfig()).resolves.toEqual({
      databaseUrl: "https://example.com/database",
      port: 3100,
      napcat: {
        wsUrl: "wss://example.com/napcat",
        reconnectMs: 3000,
        requestTimeoutMs: 10000,
        listenGroupId: "123456",
      },
    });

    await expect(manager.getLlmRuntimeConfig()).resolves.toEqual({
      activeProvider: "openai",
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
    });

    await expect(manager.getTavilyConfig()).resolves.toEqual({
      apiKey: "tavily-key",
    });
    await expect(manager.getBotProfileConfig()).resolves.toEqual({
      botQQ: "10001",
    });
  });

  it("should fail fast when a required config is missing", async () => {
    const manager = new DefaultConfigManager({
      readConfig: createReadConfig({}),
    });

    await expect(manager.getBootConfig()).rejects.toMatchObject({
      name: "ConfigManagerError",
      code: "CONFIG_NOT_FOUND",
      key: GAIA_CONFIG_KEYS.databaseUrl,
    });
  });

  it("should reject invalid config values", async () => {
    const manager = new DefaultConfigManager({
      readConfig: createReadConfig({
        [GAIA_CONFIG_KEYS.databaseUrl]: "https://example.com/database",
        [GAIA_CONFIG_KEYS.port]: "not-a-number",
        [GAIA_CONFIG_KEYS.napcatWsUrl]: "wss://example.com/napcat",
        [GAIA_CONFIG_KEYS.napcatWsReconnectMs]: "3000",
        [GAIA_CONFIG_KEYS.napcatWsRequestTimeoutMs]: "10000",
        [GAIA_CONFIG_KEYS.napcatListenGroupId]: "123456",
      }),
    });

    await expect(manager.getBootConfig()).rejects.toMatchObject({
      name: "ConfigManagerError",
      code: "CONFIG_INVALID",
      key: GAIA_CONFIG_KEYS.port,
    });
  });

  it("should return undefined for optional values when keys are missing", async () => {
    const manager = new DefaultConfigManager({
      readConfig: createReadConfig({}),
    });

    await expect(manager.getTavilyConfig()).resolves.toEqual({
      apiKey: undefined,
    });
  });

  it("should tolerate empty OpenAI config placeholders", async () => {
    const manager = new DefaultConfigManager({
      readConfig: createReadConfig({
        [GAIA_CONFIG_KEYS.databaseUrl]: "https://example.com/database",
        [GAIA_CONFIG_KEYS.napcatWsUrl]: "wss://example.com/napcat",
        [GAIA_CONFIG_KEYS.napcatWsReconnectMs]: "3000",
        [GAIA_CONFIG_KEYS.napcatWsRequestTimeoutMs]: "10000",
        [GAIA_CONFIG_KEYS.napcatListenGroupId]: "123456",
        [GAIA_CONFIG_KEYS.openaiApiKey]: "   ",
        [GAIA_CONFIG_KEYS.openaiBaseUrl]: "",
        [GAIA_CONFIG_KEYS.openaiChatModel]: " ",
      }),
    });

    await expect(manager.getLlmRuntimeConfig()).resolves.toMatchObject({
      openai: {
        apiKey: undefined,
        baseUrl: "https://api.openai.com/v1",
        chatModel: "gpt-4o-mini",
      },
    });
  });
});
