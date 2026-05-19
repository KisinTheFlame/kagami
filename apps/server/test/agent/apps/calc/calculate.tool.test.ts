import { describe, expect, it } from "vitest";
import { CalculateTool } from "../../../../src/agent/apps/calc/tools/calculate.tool.js";

describe("calc App / calculate tool", () => {
  it.each([
    [1, "+", 2, 3],
    [5, "-", 3, 2],
    [4, "*", 6, 24],
    [10, "/", 4, 2.5],
  ])("calculate(%s %s %s) = %s", async (a, op, b, expected) => {
    const tool = new CalculateTool();
    const result = await tool.execute({ a, op, b }, {});

    expect(JSON.parse(result.content)).toEqual({ ok: true, result: expected });
  });

  it("should reject division by zero", async () => {
    const tool = new CalculateTool();
    const result = await tool.execute({ a: 1, op: "/", b: 0 }, {});

    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "DIVISION_BY_ZERO",
    });
  });

  it("should reject invalid operator via schema", async () => {
    const tool = new CalculateTool();
    const result = await tool.execute({ a: 1, op: "%", b: 2 }, {});

    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVALID_ARGUMENTS",
    });
  });

  it("should reject non-finite numbers via schema", async () => {
    const tool = new CalculateTool();
    const result = await tool.execute({ a: Infinity, op: "+", b: 1 }, {});

    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVALID_ARGUMENTS",
    });
  });
});
