import { describe, expect, it } from "vitest";
import { withConnRefusedRetry } from "../../src/acl/gba-client.js";

// withConnRefusedRetry 的行为测试（GBA 无感重启的 agent 半边）：只重试「连接被拒」（请求
// 根本没进服务，对 press 非幂等调用也安全），其余失败原样穿透；重试耗尽抛最后一发；整体
// 超时信号触发后不再重试。sleep 注入避免真计时器。

/** undici 的连接被拒形状：TypeError("fetch failed") → cause 带 code=ECONNREFUSED。 */
function connRefusedError(): Error {
  const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:20015"), {
    code: "ECONNREFUSED",
  });
  return new TypeError("fetch failed", { cause });
}

/** happy-eyeballs 变体：cause 是 AggregateError，ECONNREFUSED 埋在 errors 里。 */
function connRefusedAggregateError(): Error {
  const inner = Object.assign(new Error("connect ECONNREFUSED ::1:20015"), {
    code: "ECONNREFUSED",
  });
  return new TypeError("fetch failed", { cause: new AggregateError([inner]) });
}

function stubFetch(outcomes: Array<Response | Error>): { fetch: typeof fetch; calls: number[] } {
  const calls: number[] = [];
  const fetchImpl = (async () => {
    calls.push(calls.length);
    const outcome = outcomes.shift();
    if (!outcome) {
      throw new Error("stubFetch 出招耗尽");
    }
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function recordingSleep(): { sleep: (ms: number) => Promise<void>; slept: number[] } {
  const slept: number[] = [];
  return {
    sleep: async ms => {
      slept.push(ms);
    },
    slept,
  };
}

describe("withConnRefusedRetry", () => {
  it("连接被拒后按节奏重试，端口回来即成功", async () => {
    const ok = new Response("{}");
    const { fetch: stub, calls } = stubFetch([connRefusedError(), connRefusedError(), ok]);
    const { sleep, slept } = recordingSleep();
    const wrapped = withConnRefusedRetry(stub, { delaysMs: [10, 20, 30], sleep });

    const response = await wrapped("http://127.0.0.1:20015/gba/state");
    expect(response).toBe(ok);
    expect(calls).toHaveLength(3);
    expect(slept).toEqual([10, 20]);
  });

  it("AggregateError 里的 ECONNREFUSED 也识别", async () => {
    const ok = new Response("{}");
    const { fetch: stub } = stubFetch([connRefusedAggregateError(), ok]);
    const { sleep, slept } = recordingSleep();
    const wrapped = withConnRefusedRetry(stub, { delaysMs: [10], sleep });

    await wrapped("http://127.0.0.1:20015/gba/state");
    expect(slept).toEqual([10]);
  });

  it("非连接被拒（如超时 abort / RESET）不重试，原样穿透", async () => {
    const abort = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    const { fetch: stub, calls } = stubFetch([abort]);
    const { sleep, slept } = recordingSleep();
    const wrapped = withConnRefusedRetry(stub, { delaysMs: [10, 20], sleep });

    await expect(wrapped("http://127.0.0.1:20015/gba/press")).rejects.toBe(abort);
    expect(calls).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it("重试耗尽：抛最后一发连接错误", async () => {
    const last = connRefusedError();
    const { fetch: stub, calls } = stubFetch([connRefusedError(), connRefusedError(), last]);
    const { sleep } = recordingSleep();
    const wrapped = withConnRefusedRetry(stub, { delaysMs: [10, 20], sleep });

    await expect(wrapped("http://127.0.0.1:20015/gba/state")).rejects.toBe(last);
    expect(calls).toHaveLength(3);
  });

  it("整体超时信号已触发：不再重试", async () => {
    const { fetch: stub, calls } = stubFetch([connRefusedError()]);
    const { sleep, slept } = recordingSleep();
    const wrapped = withConnRefusedRetry(stub, { delaysMs: [10], sleep });
    const controller = new AbortController();
    controller.abort();

    await expect(
      wrapped("http://127.0.0.1:20015/gba/state", { signal: controller.signal }),
    ).rejects.toThrow("fetch failed");
    expect(calls).toHaveLength(1);
    expect(slept).toEqual([]);
  });
});
