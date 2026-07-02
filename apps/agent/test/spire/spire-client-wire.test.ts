import { describe, expect, it, vi } from "vitest";
import { HttpSpireClient } from "../../src/spire/spire-client.js";
import { SpireError } from "../../src/agent/capabilities/spire/domain/errors.js";

// === spire client wire 字节基线（#279 PR2，方法论同 #240 browser-client-wire） ===
//
// 先在旧手写实现上落这组测试跑绿，再换 @kagami/spire-api + createClient 实现，期望值零改动。
// 钉死的行为：请求字节（路径 / body 键序 / query 编码）、SPIRE_NOT_READY 三种成因、
// SPIRE_REJECTED（ok:false）分支、lastVersion 在成功与拒绝两条路径上的更新、expectedVersion 重放。
//
// 已知且接受的编码注记：query 空格 旧实现 encodeURIComponent → %20，createClient 的
// URLSearchParams → +。二者在 application/x-www-form-urlencoded 语义下等价（Fastify 解析一致），
// 空格用例按解码后语义断言；CJK 等其余字符两种实现编码字节一致，按字节断言。

const SCREEN_V3 = {
  version: 3,
  screen: "combat",
  player: { hp: 68, maxHp: 75, gold: 99 },
  deckCount: 10,
  relics: [{ name: "燃烧之血", description: "战斗结束回复 6 点生命" }],
  combat: {
    turn: 1,
    energy: 3,
    maxEnergy: 3,
    block: 0,
    powers: [{ id: "strength", amount: 2 }],
    enemies: [
      {
        index: 0,
        name: "颚虫",
        hp: 40,
        maxHp: 44,
        block: 0,
        powers: [],
        intent: { kind: "attack", value: 11, hits: 1 },
      },
    ],
    hand: [
      {
        index: 0,
        name: "打击",
        cost: 1,
        type: "attack",
        targeted: true,
        description: "造成 6 点伤害",
      },
    ],
    piles: { draw: 4, discard: 0, exhaust: 0 },
  },
  options: [],
  log: ["回合开始"],
};

const SCREEN_V4 = { ...SCREEN_V3, version: 4 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeClient(fetchImpl: typeof fetch): HttpSpireClient {
  return new HttpSpireClient({ baseUrl: "http://spire", fetch: fetchImpl });
}

describe("HttpSpireClient wire 基线 — 请求字节", () => {
  it("startRun：POST /run/start，body 恒为 {}", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SCREEN_V3));
    const client = makeClient(fetchImpl);

    await client.startRun();

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://spire/run/start");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
  });

  it("act：首次动作（无已知版本）不带 expectedVersion 键", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true, screen: SCREEN_V4 }));
    const client = makeClient(fetchImpl);

    await client.act({ type: "end_turn" });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://spire/run/action");
    expect(init.body).toBe('{"action":{"type":"end_turn"}}');
  });

  it("act：携带上一响应版本作 expectedVersion（键序 action → expectedVersion）", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SCREEN_V3))
      .mockResolvedValueOnce(jsonResponse({ ok: true, screen: SCREEN_V4 }));
    const client = makeClient(fetchImpl);

    await client.startRun();
    await client.act({ type: "play_card", handIndex: 0, targetIndex: 0 });

    const [, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(init.body).toBe(
      '{"action":{"type":"play_card","handIndex":0,"targetIndex":0},"expectedVersion":3}',
    );
  });

  it("getState：GET /run/state 无 query", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SCREEN_V3));
    const client = makeClient(fetchImpl);

    await client.getState();

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://spire/run/state");
    expect(init.method).toBe("GET");
  });

  it("lookup：CJK query 编码字节不变", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ query: "打击", cards: [], terms: [] }));
    const client = makeClient(fetchImpl);

    await client.lookup("打击");

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe("http://spire/reference?q=%E6%89%93%E5%87%BB");
  });

  it("lookup：含空格 query 按解码语义断言（%20 与 + 等价）", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ query: "a b", cards: [], terms: [] }));
    const client = makeClient(fetchImpl);

    await client.lookup("a b");

    const [url] = fetchImpl.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/reference");
    expect(parsed.searchParams.get("q")).toBe("a b");
  });
});

describe("HttpSpireClient wire 基线 — 版本缓存与拒绝分支", () => {
  it("act ok:false → SPIRE_REJECTED（reason 透传），且 lastVersion 吸收拒绝屏幕的版本", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SCREEN_V3))
      .mockResolvedValueOnce(jsonResponse({ ok: false, reason: "能量不足", screen: SCREEN_V4 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, screen: { ...SCREEN_V3, version: 5 } }));
    const client = makeClient(fetchImpl);

    await client.startRun();
    await expect(client.act({ type: "play_card", handIndex: 0 })).rejects.toMatchObject({
      code: "SPIRE_REJECTED",
      message: "能量不足",
    });

    // 拒绝分支更新过 lastVersion=4：下一动作以 4 作 expectedVersion
    await client.act({ type: "end_turn" });
    const [, init] = fetchImpl.mock.calls[2] as [string, RequestInit];
    expect(init.body).toBe('{"action":{"type":"end_turn"},"expectedVersion":4}');
  });

  it("act ok:false 且 screen 为 null → lastVersion 保持不变", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SCREEN_V3))
      .mockResolvedValueOnce(jsonResponse({ ok: false, reason: "对局不存在", screen: null }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, screen: SCREEN_V4 }));
    const client = makeClient(fetchImpl);

    await client.startRun();
    await expect(client.act({ type: "end_turn" })).rejects.toMatchObject({
      code: "SPIRE_REJECTED",
    });

    await client.act({ type: "end_turn" });
    const [, init] = fetchImpl.mock.calls[2] as [string, RequestInit];
    expect(init.body).toBe('{"action":{"type":"end_turn"},"expectedVersion":3}');
  });

  it("getState 返回 null → 原样返回 null 且不动版本；返回屏幕 → 吸收版本", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(null))
      .mockResolvedValueOnce(jsonResponse(SCREEN_V4))
      .mockResolvedValueOnce(jsonResponse({ ok: true, screen: { ...SCREEN_V3, version: 5 } }));
    const client = makeClient(fetchImpl);

    expect(await client.getState()).toBeNull();
    await client.getState();
    await client.act({ type: "end_turn" });

    const [, init] = fetchImpl.mock.calls[2] as [string, RequestInit];
    expect(init.body).toBe('{"action":{"type":"end_turn"},"expectedVersion":4}');
  });
});

describe("HttpSpireClient wire 基线 — SPIRE_NOT_READY 三种成因", () => {
  it("网络异常（不可达/超时）", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    const client = makeClient(fetchImpl);

    await expect(client.getState()).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(SpireError);
      const spireError = error as SpireError;
      expect(spireError.code).toBe("SPIRE_NOT_READY");
      expect(spireError.message).toContain("尖塔服务不可达");
      expect(spireError.message).toContain("connect ECONNREFUSED");
      return true;
    });
  });

  it("非 2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ boom: 1 }, 500));
    const client = makeClient(fetchImpl);

    await expect(client.getState()).rejects.toMatchObject({
      code: "SPIRE_NOT_READY",
      message: "尖塔服务返回 HTTP 500",
    });
  });

  it("响应体不是合法 JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("<html>oops</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    const client = makeClient(fetchImpl);

    await expect(client.getState()).rejects.toMatchObject({
      code: "SPIRE_NOT_READY",
      message: "尖塔服务返回了无法解析的响应体",
    });
  });
});
