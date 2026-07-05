import { beforeAll, describe, expect, it, vi } from "vitest";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import { SchedulerClient } from "../src/scheduler-client.js";
import type { OccurrenceStore, SchedulerTaskRegistration, SchedulerTick } from "../src/types.js";

beforeAll(() => {
  initLoggerRuntime({ sinks: [{ write: () => {} }] });
});

const OFFLINE_FETCH = (async () => {
  throw new Error("offline");
}) as unknown as typeof fetch;

function makeClient(occurrenceStore?: OccurrenceStore): SchedulerClient {
  return new SchedulerClient({
    baseUrl: "http://127.0.0.1:1",
    ownerId: "agent",
    fetch: OFFLINE_FETCH,
    ...(occurrenceStore ? { occurrenceStore } : {}),
  });
}

function tick(scheduledAt: string, name = "t"): SchedulerTick {
  return {
    taskName: name,
    occurrenceId: `${name}@${scheduledAt}`,
    scheduledAt,
    emittedAt: scheduledAt,
    manual: false,
  };
}

function memStore(): OccurrenceStore {
  const map = new Map<string, string>();
  return {
    loadLastProcessed: async name => map.get(name) ?? null,
    saveLastProcessed: async (name, iso) => {
      map.set(name, iso);
    },
  };
}

function reg(
  overrides: Partial<SchedulerTaskRegistration> & Pick<SchedulerTaskRegistration, "handler">,
): SchedulerTaskRegistration {
  return {
    name: "t",
    schedule: { kind: "interval", intervalMs: 1_000 },
    misfire: "latest",
    overlap: "skip",
    ...overrides,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("SchedulerClient dispatch", () => {
  it("dispatches a tick to the matching handler", async () => {
    const client = makeClient();
    const handler = vi.fn(async () => {});
    client.register(reg({ handler }));
    await client.onTick(tick("2026-07-05T00:00:00.000Z"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores ticks for unknown tasks without throwing", async () => {
    const client = makeClient();
    client.register(reg({ handler: async () => {} }));
    await expect(client.onTick(tick("2026-07-05T00:00:00.000Z", "nope"))).resolves.toBeUndefined();
  });

  it("dedupes by occurrence scheduledAt for dedupe tasks", async () => {
    const store = memStore();
    const client = makeClient(store);
    const handler = vi.fn(async () => {});
    client.register(reg({ dedupe: true, handler }));

    await client.onTick(tick("2026-07-05T00:00:00.000Z")); // runs, marks seen
    await client.onTick(tick("2026-07-05T00:00:00.000Z")); // duplicate → skipped
    await client.onTick(tick("2026-07-05T06:00:00.000Z")); // newer → runs
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("manual triggerNow bypasses dedupe and runs locally", async () => {
    const store = memStore();
    const client = makeClient(store);
    const handler = vi.fn(async () => {});
    client.register(reg({ dedupe: true, handler }));

    await client.onTick(tick("2026-07-05T00:00:00.000Z"));
    const result = await client.triggerNow("t"); // manual: bypasses dedupe
    expect(result).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("skips overlapping runs and records skipped_overlap", async () => {
    const client = makeClient();
    const gate = deferred();
    let calls = 0;
    client.register(
      reg({
        overlap: "skip",
        handler: async () => {
          calls += 1;
          await gate.promise;
        },
      }),
    );

    const first = client.triggerNow("t"); // starts running, blocks on gate
    const second = await client.triggerNow("t"); // running → overlap
    expect(second).toEqual({ ok: false, reason: "overlap" });
    gate.resolve();
    await first;
    expect(calls).toBe(1);

    const status = await client.listStatus();
    // nextRunAt degrades to null (scheduler offline), recentRuns still local.
    expect(status[0]!.nextRunAt).toBeNull();
    expect(status[0]!.recentRuns.some(r => r.status === "success")).toBe(true);
  });

  it("triggerNow reports unknown_task for unregistered names", async () => {
    const client = makeClient();
    client.register(reg({ handler: async () => {} }));
    expect(await client.triggerNow("ghost")).toEqual({ ok: false, reason: "unknown_task" });
  });

  it("records error runs when a handler throws", async () => {
    const client = makeClient();
    client.register(
      reg({
        handler: async () => {
          throw new Error("boom");
        },
      }),
    );
    await client.onTick(tick("2026-07-05T00:00:00.000Z"));
    const status = await client.listStatus();
    const runs = status[0]!.recentRuns;
    expect(runs.at(-1)!.status).toBe("error");
    expect(runs.at(-1)!.errorMessage).toContain("boom");
  });
});
