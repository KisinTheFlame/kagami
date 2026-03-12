import { vi } from "vitest";
import type { AgentEventQueue } from "../../src/agent/event.queue.js";
import type { ConfigManager } from "../../src/config/config.manager.js";
import type { NapcatEventDao } from "../../src/dao/napcat-event.dao.js";
import type { NapcatGroupMessageChunkDao } from "../../src/dao/napcat-group-message-chunk.dao.js";
import type { NapcatGroupMessageDao } from "../../src/dao/napcat-group-message.dao.js";
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

export function createNapcatGroupMessageDao(): NapcatGroupMessageDao & {
  insert: ReturnType<typeof vi.fn>;
} {
  return {
    insert: vi.fn().mockResolvedValue(1),
    countByQuery: vi.fn().mockResolvedValue(0),
    listByQueryPage: vi.fn().mockResolvedValue([]),
    listContextWindowById: vi.fn().mockResolvedValue([]),
  };
}

export function createNapcatGroupMessageChunkDao(): NapcatGroupMessageChunkDao & {
  insert: ReturnType<typeof vi.fn>;
} {
  return {
    insert: vi.fn().mockResolvedValue(101),
    findById: vi.fn().mockResolvedValue(null),
    markIndexed: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    searchSimilar: vi.fn().mockResolvedValue([]),
  };
}

export function createConfigManager(): ConfigManager {
  return {
    getBootConfig: vi.fn().mockResolvedValue({
      databaseUrl: "postgresql://localhost:5432/kagami",
      port: 20003,
      napcat: {
        wsUrl: "ws://napcat:3001/",
        reconnectMs: 3000,
        requestTimeoutMs: 10000,
        listenGroupId: "987654",
      },
    }),
    getLlmRuntimeConfig: vi.fn(),
    getRagRuntimeConfig: vi.fn(),
    getTavilyConfig: vi.fn(),
    getBotProfileConfig: vi.fn(),
  };
}

export function createAgentEventQueue(): AgentEventQueue & {
  enqueue: ReturnType<typeof vi.fn>;
} {
  return {
    enqueue: vi.fn().mockReturnValue(1),
    drainAll: vi.fn().mockReturnValue([]),
    size: vi.fn().mockReturnValue(0),
    waitForEvent: vi.fn().mockResolvedValue(undefined),
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
