import { vi } from "vitest";
import { type AgentEventQueue } from "../../src/agent/runtime/event/event.queue.js";
import type { ConfigManager } from "@kagami/kernel/config/config.manager";
import type { Config } from "@kagami/kernel/config/config.loader";
import type { NapcatEventDao } from "@kagami/persistence/dao/napcat-event.dao";
import type { NapcatQqMessageDao } from "@kagami/persistence/dao/napcat-group-message.dao";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import type { LogEvent, LogSink } from "@kagami/kernel/logger/types";

export class FakeWebSocket {
  public readyState = 0;
  public readonly sentPayloads: string[] = [];

  private readonly listeners: Record<string, Array<(event?: unknown) => void>> = {
    open: [],
    message: [],
    close: [],
    error: [],
  };

  public send(data: string): void {
    this.sentPayloads.push(data);
  }

  public close(code = 1000, reason = "closed"): void {
    this.readyState = 3;
    this.emit("close", { code, reason });
  }

  public addEventListener(type: string, listener: (event?: unknown) => void): void {
    this.listeners[type]?.push(listener);
  }

  public emitOpen(): void {
    this.readyState = 1;
    this.emit("open");
  }

  public emitMessage(data: unknown): void {
    this.emit("message", { data });
  }

  public emitClose(code = 1000, reason = "closed"): void {
    this.readyState = 3;
    this.emit("close", { code, reason });
  }

  public emitError(event: { error?: unknown; message?: string; type?: string } = {}): void {
    this.emit("error", event);
  }

  private emit(type: string, event?: unknown): void {
    for (const listener of this.listeners[type] ?? []) {
      listener(event);
    }
  }
}

export function initTestLogger(): LogEvent[] {
  const logs: LogEvent[] = [];
  const sink: LogSink = {
    write(event) {
      logs.push(event);
    },
  };
  initLoggerRuntime({ sinks: [sink] });
  return logs;
}

export function createNapcatEventDao(): NapcatEventDao & {
  insert: ReturnType<typeof vi.fn>;
} {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    countByQuery: vi.fn().mockResolvedValue(0),
    listByQueryPage: vi.fn().mockResolvedValue([]),
  };
}

export function createNapcatGroupMessageDao(): NapcatQqMessageDao & {
  insert: ReturnType<typeof vi.fn>;
} {
  return {
    insert: vi.fn().mockResolvedValue(1),
    findByNapcatMessageId: vi.fn().mockResolvedValue(null),
    countByQuery: vi.fn().mockResolvedValue(0),
    listByQueryPage: vi.fn().mockResolvedValue([]),
    listContextWindowById: vi.fn().mockResolvedValue([]),
  };
}

export function createConfigManager(): ConfigManager {
  const config: Config = {
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
        notificationLeadingWindowMs: 10_000,
        notificationBatchWindowMs: 30_000,
        asyncTask: {
          maxTaskDurationMs: 600_000,
        },
        story: {
          enabled: true,
          batchSize: 24,
          idleFlushMs: 120_000,
          memory: {
            embedding: {
              provider: "google",
              apiKey: "gemini-key",
              baseUrl: "https://generativelanguage.googleapis.com",
              model: "gemini-embedding-001",
              outputDimensionality: 768,
            },
            vectorIndexPath: "./data/vector/story-memory.hnsw",
            retrieval: {
              topK: 3,
            },
          },
          recall: {
            enabled: true,
            topK: 2,
            scoreThreshold: 0.65,
          },
        },
        messaging: {
          aiTone: {
            enabled: true,
            blockThreshold: 0.8,
          },
        },
        resource: {
          maxBytes: 4 * 1024 * 1024,
          fileRoot: "~/kagami",
          fileMaxBytes: 32 * 1024 * 1024,
        },
      },
      ithome: {
        pollIntervalMs: 300_000,
        recentArticleLimit: 8,
        articleMaxChars: 8000,
      },
      napcat: {
        wsUrl: "ws://napcat:3001/",
        reconnectMs: 3000,
        requestTimeoutMs: 10000,
        listenGroupIds: ["987654"],
        startupContextRecentMessageCount: 40,
      },
      llm: {
        timeoutMs: 45_000,
        authUsageRefreshIntervalMs: 600_000,
        codexAuth: {
          enabled: true,
          publicBaseUrl: "http://localhost:20004",
          oauthRedirectPath: "/auth/callback",
          oauthStateTtlMs: 600_000,
          refreshLeewayMs: 60_000,
          refreshCheckIntervalMs: 60_000,
          binaryPath: "codex",
        },
        claudeCodeAuth: {
          enabled: true,
          publicBaseUrl: "http://localhost:20004",
          oauthRedirectPath: "/callback",
          oauthStateTtlMs: 600_000,
          refreshLeewayMs: 60_000,
          refreshCheckIntervalMs: 60_000,
        },
        providers: {
          deepseek: {
            apiKey: undefined,
            baseUrl: "https://api.deepseek.com",
            models: ["deepseek-chat"],
          },
          openai: {
            apiKey: undefined,
            baseUrl: "https://api.openai.com/v1",
            models: ["gpt-4o-mini"],
          },
          openaiCodex: {
            baseUrl: "https://chatgpt.com/backend-api/codex/responses",
            models: ["gpt-5.4"],
          },
          claudeCode: {
            baseUrl: "https://api.anthropic.com",
            models: ["claude-sonnet-4-20250514"],
            keepAliveReplayIntervalMinutes: 30,
          },
        },
        usages: {
          agent: {
            attempts: [{ provider: "openai", model: "gpt-4o-mini", times: 1 }],
          },
          storyAgent: {
            attempts: [{ provider: "openai", model: "gpt-4o-mini", times: 1 }],
          },
          contextSummarizer: {
            attempts: [{ provider: "openai", model: "gpt-4o-mini", times: 1 }],
          },
          vision: {
            attempts: [{ provider: "openai", model: "gpt-4o-mini", times: 1 }],
          },
          webSearchAgent: {
            attempts: [{ provider: "openai", model: "gpt-4o-mini", times: 1 }],
          },
          todoSuggestionAgent: {
            attempts: [{ provider: "openai", model: "gpt-4o-mini", times: 1 }],
          },
        },
      },
      tavily: {
        apiKey: "tavily-key",
      },
      bot: {
        qq: "10001",
        creator: {
          name: "创造者",
          qq: "10000",
        },
      },
      apps: {},
    },
  };

  return {
    config: vi.fn().mockResolvedValue(config),
  };
}

export function createAgentEventQueue(): AgentEventQueue & {
  enqueue: ReturnType<typeof vi.fn>;
} {
  return {
    enqueue: vi.fn().mockReturnValue(1),
    dequeue: vi.fn().mockReturnValue(null),
    take: vi.fn().mockResolvedValue(undefined),
    size: vi.fn().mockReturnValue(0),
    clear: vi.fn().mockReturnValue(0),
    waitNonEmpty: vi.fn().mockResolvedValue(undefined),
  };
}

export async function waitOneTick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

export async function flushMicrotasks(times = 3): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
  }
}
