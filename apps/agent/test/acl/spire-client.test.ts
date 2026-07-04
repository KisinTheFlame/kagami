import { describe, expect, it } from "vitest";
import { HttpSpireClient, type SpireScreen } from "../../src/acl/spire-client.js";
import { SpireError } from "../../src/agent/capabilities/spire/domain/errors.js";

// HttpSpireClient 的运行时行为测试（契约编译期强制见 test/spire-api-contract.test.ts）：
// 错误归一（连接失败/非 2xx/坏响应 → SPIRE_NOT_READY）、引擎拒绝带屏（SPIRE_REJECTED）、
// lastVersion 穿线成下一动作的 expectedVersion（issue #234 B 幂等）。

type FetchCall = { url: string; init: RequestInit | undefined };

function screenOf(version: number): SpireScreen {
  return {
    version,
    screen: "map",
    act: 1,
    player: { hp: 80, maxHp: 80, gold: 99 },
    deckCount: 10,
    relics: [{ name: "燃烧之血", description: "每场战斗结束后，回复 6 点生命。" }],
    potions: [],
    event: null,
    combat: null,
    options: ["0", "1"],
    log: [],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(responses: Array<Response | Error>): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (next === undefined) {
      throw new Error("stubFetch: 响应队列耗尽");
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

describe("HttpSpireClient 错误归一", () => {
  it("连接失败 → SPIRE_NOT_READY（消息带原因）", async () => {
    const { fetch } = stubFetch([new Error("ECONNREFUSED")]);
    const client = new HttpSpireClient({ baseUrl: "http://spire", fetch });
    const error = await client.getState().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SpireError);
    expect((error as SpireError).code).toBe("SPIRE_NOT_READY");
    expect((error as SpireError).message).toContain("不可达");
  });

  it("非 2xx → SPIRE_NOT_READY（不走 BizErrorWire 解码）", async () => {
    const { fetch } = stubFetch([
      jsonResponse({ error: { message: "尖塔服务内部错误", statusCode: 500 } }, 500),
    ]);
    const client = new HttpSpireClient({ baseUrl: "http://spire", fetch });
    const error = await client.startRun().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SpireError);
    expect((error as SpireError).code).toBe("SPIRE_NOT_READY");
    expect((error as SpireError).message).toContain("HTTP 500");
  });

  it("2xx 但响应体非 JSON → SPIRE_NOT_READY", async () => {
    const { fetch } = stubFetch([new Response("not json", { status: 200 })]);
    const client = new HttpSpireClient({ baseUrl: "http://spire", fetch });
    const error = await client.startRun().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SpireError);
    expect((error as SpireError).code).toBe("SPIRE_NOT_READY");
  });
});

describe("HttpSpireClient 版本穿线与引擎拒绝", () => {
  it("startRun 记住版本，act 带 expectedVersion；成功后随响应推进", async () => {
    const { fetch, calls } = stubFetch([
      jsonResponse(screenOf(3)),
      jsonResponse({ ok: true, screen: screenOf(4) }),
      jsonResponse({ ok: true, screen: screenOf(5) }),
    ]);
    const client = new HttpSpireClient({ baseUrl: "http://spire", fetch });

    await client.startRun();
    await client.act({ type: "end_turn" });
    await client.act({ type: "end_turn" });

    const firstAct = JSON.parse(String(calls[1]!.init?.body)) as { expectedVersion?: number };
    const secondAct = JSON.parse(String(calls[2]!.init?.body)) as { expectedVersion?: number };
    expect(firstAct.expectedVersion).toBe(3);
    expect(secondAct.expectedVersion).toBe(4);
  });

  it("引擎拒绝（ok:false 带屏）→ SPIRE_REJECTED，且用带回的屏幕版本更新 lastVersion", async () => {
    const { fetch, calls } = stubFetch([
      jsonResponse(screenOf(3)),
      jsonResponse({ ok: false, reason: "能量不足", screen: screenOf(7) }),
      jsonResponse({ ok: true, screen: screenOf(8) }),
    ]);
    const client = new HttpSpireClient({ baseUrl: "http://spire", fetch });

    await client.startRun();
    const error = await client.act({ type: "play_card", handIndex: 0 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SpireError);
    expect((error as SpireError).code).toBe("SPIRE_REJECTED");
    expect((error as SpireError).message).toBe("能量不足");

    await client.act({ type: "end_turn" });
    const retry = JSON.parse(String(calls[2]!.init?.body)) as { expectedVersion?: number };
    expect(retry.expectedVersion).toBe(7);
  });
});
