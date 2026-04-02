import { vi } from "vitest";
import { type AgentEventQueue } from "../../src/agent/runtime/event/event.queue.js";
import type { ConfigManager } from "../../src/config/config.manager.js";
import type { Config } from "../../src/config/config.loader.js";
import type { NapcatEventDao } from "../../src/napcat/dao/napcat-event.dao.js";
import type { NapcatQqMessageDao } from "../../src/napcat/dao/napcat-group-message.dao.js";
import { initLoggerRuntime } from "../../src/logger/runtime.js";
import type { LogEvent, LogSink } from "../../src/logger/types.js";

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
    countByQuery: vi.fn().mockResolvedValue(0),
    listByQueryPage: vi.fn().mockResolvedValue([]),
    listContextWindowById: vi.fn().mockResolvedValue([]),
  };
}

export function createConfigManager(): ConfigManager {
  const config: Config = {
    server: {
      databaseUrl: "postgresql://localhost:5432/kagami",
      port: 20003,
      agent: {
        contextCompactionTotalTokenThreshold: 150_000,
        llmRetryBackoffMs: 30_000,
        waitToolMaxWaitMs: 600_000,
        story: {
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
            retrieval: {
              topK: 3,
            },
          },
        },
      },
      news: {
        ithome: {
          pollIntervalMs: 300_000,
          recentArticleLimit: 8,
          articleMaxChars: 8000,
        },
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
        codexAuth: {
          enabled: true,
          publicBaseUrl: "http://localhost:20004",
          oauthRedirectPath: "/auth/callback",
          oauthStateTtlMs: 600_000,
          refreshLeewayMs: 60_000,
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
    size: vi.fn().mockReturnValue(0),
    clear: vi.fn().mockReturnValue(0),
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
