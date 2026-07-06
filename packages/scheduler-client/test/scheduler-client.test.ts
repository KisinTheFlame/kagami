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
    callbackBaseUrl: "http://127.0.0.1:2",
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

  it("does not advance the dedupe cursor when a dedupe handler fails, so a re-delivery retries", async () => {
    const store = memStore();
    const client = makeClient(store);
    let calls = 0;
    const handler = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("digest generation blew up");
      }
    });
    client.register(reg({ dedupe: true, handler }));

    await client.onTick(tick("2026-07-05T00:00:00.000Z")); // handler throws → cursor NOT advanced
    await client.onTick(tick("2026-07-05T00:00:00.000Z")); // same occurrence re-delivered → retried
    expect(handler).toHaveBeenCalledTimes(2);
    // second run succeeded → cursor now advanced → a third re-delivery is deduped away
    await client.onTick(tick("2026-07-05T00:00:00.000Z"));
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

  it("triggerNowDetached returns the receipt without awaiting the handler", async () => {
    const client = makeClient();
    const gate = deferred();
    let started = false;
    let finished = false;
    client.register(
      reg({
        handler: async () => {
          started = true;
          await gate.promise;
          finished = true;
        },
      }),
    );

    // 同步受理：立即回 accepted，不等 handler 跑完（P3 修复的核心——callback 5s 超时不能等长任务）。
    expect(client.triggerNowDetached("t")).toEqual({ ok: true });
    await Promise.resolve(); // 放行一个 microtask 让后台 handler 起跑
    expect(started).toBe(true);
    expect(finished).toBe(false); // handler 仍阻塞在 gate，受理已返回

    // 在跑中 → 第二次 detached 触发被判 overlap（与 SSE tick 共用同一把同步锁）。
    expect(client.triggerNowDetached("t")).toEqual({ ok: false, reason: "overlap" });

    gate.resolve();
    await gate.promise;
    await new Promise(resolve => setTimeout(resolve, 0)); // 等后台 runClaimed 收尾 + finally 释放锁
    expect(finished).toBe(true);
    // 锁已释放 → 可再次触发。
    expect(client.triggerNowDetached("t")).toEqual({ ok: true });
  });

  it("triggerNowDetached reports unknown_task for unregistered names", () => {
    const client = makeClient();
    client.register(reg({ handler: async () => {} }));
    expect(client.triggerNowDetached("ghost")).toEqual({ ok: false, reason: "unknown_task" });
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

// === run 上报（两阶段回报 + 未 ack 缓冲，#493 P2）===

type CapturedReport = Record<string, unknown>;

/**
 * 造一个只认 POST /scheduler/runs 的 fetch mock：把请求体收集起来，可控制某几次调用失败（模拟离线）。
 * `failFirst` 让开头 N 次上报抛错，进未 ack 缓冲；其余成功返回 { ok: true }。
 */
function makeReportFetch(opts: { failFirst?: number } = {}): {
  fetch: typeof fetch;
  reports: CapturedReport[];
} {
  const reports: CapturedReport[] = [];
  let calls = 0;
  const failFirst = opts.failFirst ?? 0;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    calls += 1;
    if (calls <= failFirst) {
      throw new Error("offline");
    }
    const body = init?.body ? (JSON.parse(String(init.body)) as CapturedReport) : {};
    reports.push(body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as Response;
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, reports };
}

function makeReportClient(fetchImpl: typeof fetch): SchedulerClient {
  return new SchedulerClient({
    baseUrl: "http://127.0.0.1:1",
    ownerId: "agent",
    callbackBaseUrl: "http://127.0.0.1:2",
    fetch: fetchImpl,
  });
}

describe("SchedulerClient run reporting", () => {
  it("reports running then a terminal success under the same run id (two-phase)", async () => {
    const { fetch: f, reports } = makeReportFetch();
    const client = makeReportClient(f);
    client.register(reg({ handler: async () => {} }));

    await client.onTick(tick("2026-07-05T00:00:00.000Z"));
    await client.settleReports(); // 回报是 fire-and-forget，等在途上报排空再断言。

    expect(reports).toHaveLength(2);
    expect(reports[0]!.status).toBe("running");
    expect(reports[1]!.status).toBe("success");
    // 同一 runId 两次上报。
    expect(reports[0]!.id).toBe(reports[1]!.id);
    expect(reports[1]!.finishedAt).toBeTypeOf("string");
    expect(reports[1]!.durationMs).toBeTypeOf("number");
    // scheduled 触发带 scheduledAt，trigger=scheduled。
    expect(reports[0]!.trigger).toBe("scheduled");
    expect(reports[0]!.scheduledAt).toBe("2026-07-05T00:00:00.000Z");
  });

  it("maps a thrown handler to a failure terminal report with the error message", async () => {
    const { fetch: f, reports } = makeReportFetch();
    const client = makeReportClient(f);
    client.register(
      reg({
        handler: async () => {
          throw new Error("kaboom");
        },
      }),
    );

    await client.onTick(tick("2026-07-05T00:00:00.000Z"));
    await client.settleReports();

    expect(reports).toHaveLength(2);
    expect(reports[0]!.status).toBe("running");
    expect(reports[1]!.status).toBe("failure");
    expect(reports[1]!.error).toContain("kaboom");
  });

  it("reports manual triggerNow with trigger=manual and null scheduledAt", async () => {
    const { fetch: f, reports } = makeReportFetch();
    const client = makeReportClient(f);
    client.register(reg({ handler: async () => {} }));

    await client.triggerNow("t");
    await client.settleReports();

    expect(reports).toHaveLength(2);
    expect(reports[0]!.trigger).toBe("manual");
    expect(reports[0]!.scheduledAt).toBeNull();
  });

  it("does not report skipped_overlap runs (never truly ran)", async () => {
    const { fetch: f, reports } = makeReportFetch();
    const client = makeReportClient(f);
    const gate = deferred();
    client.register(
      reg({
        overlap: "skip",
        handler: async () => {
          await gate.promise;
        },
      }),
    );

    const first = client.triggerNow("t"); // 占锁，阻塞在 gate
    const second = await client.triggerNow("t"); // running → overlap，不跑不上报
    expect(second).toEqual({ ok: false, reason: "overlap" });
    gate.resolve();
    await first;
    await client.settleReports();

    // 只有真跑的那次两阶段上报；skipped_overlap 不产生任何上报。
    expect(reports.filter(r => r.status === "running")).toHaveLength(1);
    expect(reports).toHaveLength(2);
  });

  it("reports callbackBaseUrl in the register request (#493 P3)", async () => {
    // 造一个只认 POST /scheduler/register 的 fetch mock：捕获 register body，回 accepted，然后让
    // 后续 SSE 打开失败（回 500）以尽快退出 connectOnce，避免真去长连。
    let registerBody: Record<string, unknown> | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/scheduler/register")) {
        registerBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return {
          ok: true,
          status: 200,
          json: async () => ({ accepted: true, generation: registerBody!.generation }),
        } as Response;
      }
      // SSE 打开：回非 2xx 让 connectOnce 抛出、loop 退避（测试里随即 stop）。
      return { ok: false, status: 500, body: null } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = new SchedulerClient({
      baseUrl: "http://127.0.0.1:1",
      ownerId: "agent",
      callbackBaseUrl: "http://127.0.0.1:20003",
      fetch: fetchImpl,
    });
    client.register(reg({ handler: async () => {} }));
    client.start();
    // 轮询等 register 发生（后台循环异步）。
    for (let i = 0; i < 50 && registerBody === undefined; i += 1) {
      await new Promise(r => setTimeout(r, 5));
    }
    client.stop();

    expect(registerBody).toBeDefined();
    expect(registerBody!.callbackBaseUrl).toBe("http://127.0.0.1:20003");
    expect(registerBody!.ownerId).toBe("agent");
  });

  it("buffers a failed report and re-pushes it on the next report attempt (at-least-once)", async () => {
    // 让前 1 次上报失败（running 进缓冲），后续成功：下一次上报前会先 flush 掉缓冲里的 running。
    const { fetch: f, reports } = makeReportFetch({ failFirst: 1 });
    const client = makeReportClient(f);
    client.register(reg({ handler: async () => {} }));

    await client.onTick(tick("2026-07-05T00:00:00.000Z"));
    await client.settleReports();

    // running 首发失败→缓冲；终态上报前 flush 出 running，再发终态 → 共 2 条成功落地。
    expect(reports).toHaveLength(2);
    const statuses = reports.map(r => r.status);
    expect(statuses).toContain("running");
    expect(statuses).toContain("success");
  });
});
