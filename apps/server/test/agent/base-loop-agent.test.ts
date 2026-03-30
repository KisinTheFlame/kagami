import { describe, expect, it, vi } from "vitest";
import {
  BaseLoopAgent,
  ReActKernel,
  ToolCatalog,
  type LoopAgentEventsConsumedSummary,
  type LoopAgentExtension,
} from "@kagami/agent-runtime";

type TestAssistantMessage = {
  role: "assistant";
  content: string;
  toolCalls: never[];
};

type TestToolMessage = {
  role: "tool";
  toolCallId: string;
  content: string;
};

type TestMessage = TestAssistantMessage | TestToolMessage;

type TestCompletion = {
  message: TestAssistantMessage;
};

type TestLoopContext = {
  order: string[];
};

class TestLoopAgent extends BaseLoopAgent<
  TestMessage,
  "test",
  TestCompletion,
  unknown,
  TestLoopContext
> {
  private readonly context: TestLoopContext;
  private readonly shouldRunRoundValue: boolean;
  private readonly beforeTickSummary: LoopAgentEventsConsumedSummary;
  private readonly afterTickSpy?: (didRunRound: boolean) => void;

  public constructor(input: {
    kernel: ReActKernel<TestMessage, "test", TestCompletion>;
    extensions?: LoopAgentExtension<TestLoopContext, TestMessage, "test", TestCompletion>[];
    context: TestLoopContext;
    shouldRunRound?: boolean;
    beforeTickSummary?: LoopAgentEventsConsumedSummary;
    sleep?: (ms: number) => Promise<void>;
    afterTickSpy?: (didRunRound: boolean) => void;
  }) {
    super({
      kernel: input.kernel,
      extensions: input.extensions,
      sleep: input.sleep,
    });
    this.context = input.context;
    this.shouldRunRoundValue = input.shouldRunRound ?? true;
    this.beforeTickSummary = input.beforeTickSummary ?? {
      shouldTriggerRound: false,
    };
    this.afterTickSpy = input.afterTickSpy;
  }

  protected override async initializeHostIfNeeded(): Promise<void> {}

  protected override createLoopExtensionContext(): TestLoopContext {
    return this.context;
  }

  protected override async beforeTick(): Promise<LoopAgentEventsConsumedSummary> {
    this.context.order.push("beforeTick");
    return this.beforeTickSummary;
  }

  protected override async shouldRunRound(): Promise<boolean> {
    this.context.order.push("shouldRunRound");
    return this.shouldRunRoundValue;
  }

  protected override async buildRoundInput() {
    this.context.order.push("buildRoundInput");
    return {
      state: {
        systemPrompt: "system",
        messages: [],
      },
      tools: new ToolCatalog<TestMessage>([]).pick([]),
      usage: "test" as const,
    };
  }

  protected override async commitRoundResult(): Promise<void> {
    this.context.order.push("commitRoundResult");
  }

  protected override async afterTick(input: { didRunRound: boolean }): Promise<number> {
    this.context.order.push("afterTick");
    this.afterTickSpy?.(input.didRunRound);
    return 1;
  }
}

describe("BaseLoopAgent", () => {
  it("should invoke loop extensions in registration order and await async hooks", async () => {
    const order: string[] = [];
    const sleepDeferred = createDeferred<void>();
    const kernel = new ReActKernel<TestMessage, "test", TestCompletion>({
      model: {
        chat: vi.fn(async () => {
          order.push("model");
          return {
            message: {
              role: "assistant" as const,
              content: "done",
              toolCalls: [],
            },
          };
        }),
      },
    });
    const extensions: LoopAgentExtension<TestLoopContext, TestMessage, "test", TestCompletion>[] = [
      {
        onInitialize: async context => {
          context.order.push("ext1:init:start");
          await Promise.resolve();
          context.order.push("ext1:init:end");
        },
        onAfterEventsConsumed: async ({ context }) => {
          context.order.push("ext1:afterEvents:start");
          await Promise.resolve();
          context.order.push("ext1:afterEvents:end");
        },
        onBeforeRound: async context => {
          context.order.push("ext1:beforeRound:start");
          await Promise.resolve();
          context.order.push("ext1:beforeRound:end");
        },
        onAfterRound: async ({ context }) => {
          context.order.push("ext1:afterRound");
        },
        onAfterCommit: async ({ context }) => {
          context.order.push("ext1:afterCommit");
        },
      },
      {
        onInitialize: context => {
          context.order.push("ext2:init");
        },
        onAfterEventsConsumed: ({ context }) => {
          context.order.push("ext2:afterEvents");
        },
        onBeforeRound: context => {
          context.order.push("ext2:beforeRound");
        },
        onAfterRound: ({ context }) => {
          context.order.push("ext2:afterRound");
        },
        onAfterCommit: ({ context }) => {
          context.order.push("ext2:afterCommit");
        },
      },
    ];
    const agent = new TestLoopAgent({
      kernel,
      extensions,
      context: { order },
      beforeTickSummary: { shouldTriggerRound: true },
      sleep: vi.fn(() => sleepDeferred.promise),
    });

    const startPromise = agent.start();
    await vi.waitFor(() => {
      expect(order).toContain("ext2:afterCommit");
    });
    const stopPromise = agent.stop();
    sleepDeferred.resolve();
    await stopPromise;
    await startPromise;

    expect(order).toEqual([
      "ext1:init:start",
      "ext1:init:end",
      "ext2:init",
      "beforeTick",
      "ext1:afterEvents:start",
      "ext1:afterEvents:end",
      "ext2:afterEvents",
      "shouldRunRound",
      "ext1:beforeRound:start",
      "ext1:beforeRound:end",
      "ext2:beforeRound",
      "buildRoundInput",
      "model",
      "ext1:afterRound",
      "ext2:afterRound",
      "commitRoundResult",
      "ext1:afterCommit",
      "ext2:afterCommit",
      "afterTick",
    ]);
  });

  it("should treat missing hooks as no-op and trigger onIdle when no round runs", async () => {
    const order: string[] = [];
    const sleepDeferred = createDeferred<void>();
    const agent = new TestLoopAgent({
      kernel: new ReActKernel<TestMessage, "test", TestCompletion>({
        model: {
          chat: vi.fn(async () => ({
            message: {
              role: "assistant" as const,
              content: "unused",
              toolCalls: [],
            },
          })),
        },
      }),
      extensions: [
        {
          onIdle: context => {
            context.order.push("idle");
          },
        },
      ],
      context: { order },
      shouldRunRound: false,
      sleep: vi.fn(() => sleepDeferred.promise),
    });

    const startPromise = agent.start();
    await vi.waitFor(() => {
      expect(order).toContain("idle");
    });
    const stopPromise = agent.stop();
    sleepDeferred.resolve();
    await stopPromise;
    await startPromise;

    expect(order).toEqual(["beforeTick", "shouldRunRound", "idle", "afterTick"]);
  });

  it("should trigger unhandled-error hooks when loop execution fails", async () => {
    const error = new Error("boom");
    const onUnhandledError = vi.fn();
    const agent = new TestLoopAgent({
      kernel: new ReActKernel<TestMessage, "test", TestCompletion>({
        model: {
          chat: vi.fn(async () => {
            throw error;
          }),
        },
      }),
      extensions: [
        {
          onUnhandledError,
        },
      ],
      context: { order: [] },
    });

    await expect(agent.start()).rejects.toThrow(error);
    expect(onUnhandledError).toHaveBeenCalledWith({
      context: {
        order: ["beforeTick", "shouldRunRound", "buildRoundInput"],
      },
      error,
    });
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}
