import { describe, expect, it } from "vitest";
import { CalculateTool } from "../../../../src/agent/apps/calc/tools/calculate.tool.js";

function makeTool(precision?: number) {
  return new CalculateTool({ getPrecision: () => precision });
}

describe("calc App / calculate tool", () => {
  it.each([
    [1, "+", 2, 3],
    [5, "-", 3, 2],
    [4, "*", 6, 24],
    [10, "/", 4, 2.5],
  ])("calculate(%s %s %s) = %s", async (a, op, b, expected) => {
    const tool = makeTool();
    const result = await tool.execute({ a, op, b }, {});

    expect(JSON.parse(result.content)).toEqual({ ok: true, result: expected });
  });

  it("should reject division by zero", async () => {
    const tool = makeTool();
    const result = await tool.execute({ a: 1, op: "/", b: 0 }, {});

    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "DIVISION_BY_ZERO",
    });
  });

  it("should reject invalid operator via schema", async () => {
    const tool = makeTool();
    const result = await tool.execute({ a: 1, op: "%", b: 2 }, {});

    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVALID_ARGUMENTS",
    });
  });

  it("should reject non-finite numbers via schema", async () => {
    const tool = makeTool();
    const result = await tool.execute({ a: Infinity, op: "+", b: 1 }, {});

    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVALID_ARGUMENTS",
    });
  });

  describe("precision config", () => {
    it("undefined precision keeps full float result", async () => {
      const tool = makeTool(undefined);
      const result = await tool.execute({ a: 1, op: "/", b: 3 }, {});

      expect(JSON.parse(result.content)).toEqual({ ok: true, result: 1 / 3 });
    });

    it("precision 2 rounds to 2 decimal places", async () => {
      const tool = makeTool(2);
      const result = await tool.execute({ a: 1, op: "/", b: 3 }, {});

      expect(JSON.parse(result.content)).toEqual({ ok: true, result: 0.33 });
    });

    it("precision 0 rounds to integer", async () => {
      const tool = makeTool(0);
      const result = await tool.execute({ a: 7, op: "/", b: 2 }, {});

      expect(JSON.parse(result.content)).toEqual({ ok: true, result: 4 });
    });

    it("precision reads at execute-time so app config changes take effect", async () => {
      let precision: number | undefined = undefined;
      const tool = new CalculateTool({ getPrecision: () => precision });

      const before = await tool.execute({ a: 1, op: "/", b: 3 }, {});
      expect(JSON.parse(before.content)).toEqual({ ok: true, result: 1 / 3 });

      precision = 4;
      const after = await tool.execute({ a: 1, op: "/", b: 3 }, {});
      expect(JSON.parse(after.content)).toEqual({ ok: true, result: 0.3333 });
    });
  });
});
