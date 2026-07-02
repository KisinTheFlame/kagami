import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  shutdownServerResources,
  type AgentRuntimeController,
} from "../../src/app/server-shutdown.js";

type ShutdownLoggerStub = {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  errorWithCause: ReturnType<typeof vi.fn>;
};

function createLoggerStub(): ShutdownLoggerStub {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    errorWithCause: vi.fn(),
  };
}

function createAgentRuntimeStub(order: string[], label: string): AgentRuntimeController {
  return {
    stop: vi.fn(async () => {
      order.push(label);
    }),
  };
}

describe("shutdownServerResources", () => {
  it("按预期顺序关闭资源", async () => {
    const order: string[] = [];
    const logger = createLoggerStub();
    const app = {
      close: vi.fn(async () => {
        order.push("app.close");
      }),
    } as unknown as FastifyInstance;
    const shutdownApps = vi.fn(async () => {
      order.push("shutdownApps");
    });
    const taskScheduler = {
      stop: vi.fn(async () => {
        order.push("taskScheduler.stop");
      }),
    };
    const callbackServer = {
      stop: vi.fn(async () => {
        order.push("callbackServer.stop");
      }),
    };
    const rootAgentRuntime = createAgentRuntimeStub(order, "rootAgentRuntime.stop");
    const closeLlmProviders = vi.fn(async () => {
      order.push("closeLlmProviders");
    });
    const closeLoggerRuntime = vi.fn(async () => {
      order.push("closeLoggerRuntime");
    });
    const closeDatabase = vi.fn(async () => {
      order.push("closeDb");
    });
    const exit = vi.fn((code: number) => {
      order.push(`exit(${code})`);
    });

    await shutdownServerResources({
      signal: "SIGTERM",
      timeoutMs: 10_000,
      isServerStarted: true,
      app,
      database: {} as never,
      shutdownApps,
      taskScheduler: taskScheduler as never,
      callbackServers: [callbackServer],
      rootAgentRuntime,
      closeLlmProviders,
      logger,
      closeLoggerRuntime,
      closeDatabase,
      exit,
      setShutdownTimeout: () => ({}) as ReturnType<typeof setTimeout>,
      clearShutdownTimeout: () => {},
    });

    expect(order).toEqual([
      "app.close",
      "shutdownApps",
      "taskScheduler.stop",
      "callbackServer.stop",
      "rootAgentRuntime.stop",
      "closeLlmProviders",
      "closeLoggerRuntime",
      "closeDb",
      "exit(0)",
    ]);
  });

  it("root agent 为空时仍能安全完成关停", async () => {
    const logger = createLoggerStub();
    const closeLoggerRuntime = vi.fn(async () => {});
    const closeDatabase = vi.fn(async () => {});
    const exit = vi.fn();

    await shutdownServerResources({
      signal: "SIGINT",
      timeoutMs: 10_000,
      isServerStarted: false,
      app: null,
      database: {} as never,
      shutdownApps: null,
      taskScheduler: null,
      callbackServers: [],
      rootAgentRuntime: null,
      closeLlmProviders: null,
      logger,
      closeLoggerRuntime,
      closeDatabase,
      exit,
      setShutdownTimeout: () => ({}) as ReturnType<typeof setTimeout>,
      clearShutdownTimeout: () => {},
    });

    expect(closeDatabase).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("成功关停时 root agent stop 只调用一次", async () => {
    const logger = createLoggerStub();
    const rootAgentRuntime = {
      stop: vi.fn(async () => {}),
    };
    const exit = vi.fn();

    await shutdownServerResources({
      signal: "SIGTERM",
      timeoutMs: 10_000,
      isServerStarted: false,
      app: null,
      database: null,
      shutdownApps: null,
      taskScheduler: null,
      callbackServers: [],
      rootAgentRuntime,
      closeLlmProviders: null,
      logger,
      closeLoggerRuntime: async () => {},
      closeDatabase: async () => {},
      exit,
      setShutdownTimeout: () => ({}) as ReturnType<typeof setTimeout>,
      clearShutdownTimeout: () => {},
    });

    expect(rootAgentRuntime.stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("root agent stop 失败时保持现有关停失败语义并退出 1", async () => {
    const logger = createLoggerStub();
    const rootStopError = new Error("root stop failed");
    const rootAgentRuntime = {
      stop: vi.fn(async () => {
        throw rootStopError;
      }),
    };
    const closeLlmProviders = vi.fn(async () => {});
    const closeLoggerRuntime = vi.fn(async () => {});
    const closeDatabase = vi.fn(async () => {});
    const exit = vi.fn();

    await shutdownServerResources({
      signal: "SIGTERM",
      timeoutMs: 10_000,
      isServerStarted: false,
      app: null,
      database: {} as never,
      shutdownApps: null,
      taskScheduler: null,
      callbackServers: [],
      rootAgentRuntime,
      closeLlmProviders,
      logger,
      closeLoggerRuntime,
      closeDatabase,
      exit,
      setShutdownTimeout: () => ({}) as ReturnType<typeof setTimeout>,
      clearShutdownTimeout: () => {},
    });

    expect(rootAgentRuntime.stop).toHaveBeenCalledTimes(1);
    expect(closeLlmProviders).not.toHaveBeenCalled();
    expect(closeLoggerRuntime).not.toHaveBeenCalled();
    expect(closeDatabase).not.toHaveBeenCalled();
    expect(logger.errorWithCause).toHaveBeenCalledWith("Shutdown failed", rootStopError, {
      event: "server.shutdown.failed",
      signal: "SIGTERM",
    });
    expect(exit).toHaveBeenCalledWith(1);
  });
});
