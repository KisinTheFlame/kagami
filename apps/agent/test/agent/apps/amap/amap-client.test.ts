import { afterEach, describe, expect, it, vi } from "vitest";
import { AmapClient } from "../../../../src/agent/apps/amap/client/amap-client.js";

function buildClient(): AmapClient {
  return new AmapClient({
    apiKey: "K",
    fetchOptions: { timeoutMs: 1000, maxAttempts: 1, backoffBaseMs: 1, backoffMaxMs: 2 },
    poiPageSize: 10,
    poiPageSizeCap: 25,
    aroundDefaultRadiusMeters: 1000,
    aroundRadiusCapMeters: 50000,
  });
}

/** Records requested URLs and replies with a fixed JSON envelope (infocode 10000). */
function recordingFetch(body: unknown): { calls: string[]; mock: ReturnType<typeof vi.fn> } {
  const calls: string[] = [];
  const mock = vi.fn().mockImplementation((url: string) => {
    calls.push(url);
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ infocode: "10000", ...(body as object) }),
    } as unknown as Response);
  });
  return { calls, mock };
}

describe("AmapClient URL building", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("geocode hits /v3/geocode/geo with key + address", async () => {
    const { calls, mock } = recordingFetch({ geocodes: [] });
    vi.stubGlobal("fetch", mock);
    await buildClient().geocode({ address: "天安门", city: "北京" });
    expect(calls[0]).toContain("/v3/geocode/geo?");
    expect(calls[0]).toContain("key=K");
    expect(calls[0]).toContain("address=");
    expect(calls[0]).toContain("city=");
  });

  it("search_poi uses page_size/page_num (NOT page) and v5 place/text", async () => {
    const { calls, mock } = recordingFetch({ pois: [], count: "0" });
    vi.stubGlobal("fetch", mock);
    await buildClient().searchPoi({ keywords: "肯德基", region: "北京", pageNum: 2 });
    expect(calls[0]).toContain("/v5/place/text?");
    expect(calls[0]).toContain("page_size=10");
    expect(calls[0]).toContain("page_num=2");
    expect(calls[0]).not.toMatch(/[?&]page=/);
  });

  it("search_around normalizes location and clamps radius to cap", async () => {
    const { calls, mock } = recordingFetch({ pois: [], count: "0" });
    vi.stubGlobal("fetch", mock);
    await buildClient().searchAround({ location: "116.397463,39.909187", radius: 999999 });
    expect(calls[0]).toContain("/v5/place/around?");
    expect(calls[0]).toContain("radius=50000");
    expect(calls[0]).toContain("location=116.397463%2C39.909187");
  });

  it("plan_route requests show_fields=cost,navi on the chosen mode", async () => {
    const { calls, mock } = recordingFetch({ route: { paths: [] } });
    vi.stubGlobal("fetch", mock);
    await buildClient().planRoute({
      origin: "116.39,39.90",
      destination: "116.47,39.87",
      mode: "driving",
    });
    expect(calls[0]).toContain("/v5/direction/driving?");
    expect(calls[0]).toContain("show_fields=cost%2Cnavi");
  });

  it("plan_transit hits transit/integrated with city1/city2 (citycode)", async () => {
    const { calls, mock } = recordingFetch({ route: { transits: [] } });
    vi.stubGlobal("fetch", mock);
    await buildClient().planTransit({
      origin: "116.39,39.90",
      destination: "116.47,39.87",
      city1: "010",
      city2: "010",
    });
    expect(calls[0]).toContain("/v5/direction/transit/integrated?");
    expect(calls[0]).toContain("city1=010");
    expect(calls[0]).toContain("city2=010");
  });

  it("weather passes adcode as city + extensions", async () => {
    const { calls, mock } = recordingFetch({ lives: [] });
    vi.stubGlobal("fetch", mock);
    await buildClient().weather({ adcode: "110000", kind: "all" });
    expect(calls[0]).toContain("/v3/weather/weatherInfo?");
    expect(calls[0]).toContain("city=110000");
    expect(calls[0]).toContain("extensions=all");
  });

  it("throws (not silent-empty) when the response shape can't be parsed", async () => {
    // infocode 10000 but geocodes is a string, not an array → schema parse fails.
    const { mock } = recordingFetch({ geocodes: "oops" });
    vi.stubGlobal("fetch", mock);
    await expect(buildClient().geocode({ address: "x" })).rejects.toMatchObject({
      meta: { reason: "AMAP_PARSE_FAILED" },
    });
  });

  it("reads bicycling duration from the top-level path.duration (no cost object)", async () => {
    const { mock } = recordingFetch({
      // bicycling returns step_distance as a NUMBER (not string) — must still parse.
      route: {
        paths: [
          {
            distance: "3794",
            duration: "1315",
            steps: [{ instruction: "骑行", step_distance: 215 }],
          },
        ],
      },
    });
    vi.stubGlobal("fetch", mock);
    const paths = await buildClient().planRoute({
      origin: "116.39,39.90",
      destination: "116.47,39.87",
      mode: "bicycling",
    });
    expect(paths[0]).toMatchObject({ distanceMeters: "3794", durationSeconds: "1315" });
  });

  it("static_map uppercases marker label, drops CJK/multichar, rejects bad color", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        calls.push(url);
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: {
            get: (k: string) => (k.toLowerCase() === "content-type" ? "image/png" : null),
          },
          arrayBuffer: async () => new ArrayBuffer(2),
        } as unknown as Response);
      }),
    );
    await buildClient().staticMap({
      size: "400*300",
      scale: 2,
      markers: [{ label: "a", color: "0xAB:CD", points: ["116.39,39.90"] }],
    });
    const decoded = decodeURIComponent(calls[0]);
    // lowercase 'a' → 'A'; bad color 0xAB:CD → default 0xFF0000.
    expect(decoded).toContain("mid,0xFF0000,A:116.39,39.9");
  });

  it("parses a driving path into distance/duration/steps", async () => {
    const { mock } = recordingFetch({
      route: {
        paths: [
          {
            distance: "12326",
            cost: { duration: "1800" },
            steps: [{ instruction: "向北行驶" }, { instruction: "右转" }],
          },
        ],
      },
    });
    vi.stubGlobal("fetch", mock);
    const paths = await buildClient().planRoute({
      origin: "116.39,39.90",
      destination: "116.47,39.87",
      mode: "driving",
    });
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatchObject({ distanceMeters: "12326", durationSeconds: "1800" });
    expect(paths[0].steps).toEqual(["向北行驶", "右转"]);
  });
});
