import { describe, expect, it } from "vitest";
import { EnterTool } from "../../src/agent/runtime/root-agent/tools/enter.tool.js";

describe("enter tool", () => {
  it("should enter qq group with flattened arguments", async () => {
    const tool = new EnterTool();
    const result = await tool.execute(
      {
        kind: "qq_group",
        id: "group-1",
      },
      {
        rootAgentSession: {
          enter: async (input: { kind: "qq_group" | "zone_out"; id?: string }) => ({
            ok: true,
            ...input,
          }),
        },
      } as Parameters<typeof tool.execute>[1],
    );

    expect(tool.name).toBe("enter");
    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      kind: "qq_group",
      id: "group-1",
    });
  });

  it("should reject missing id when entering qq group", async () => {
    const tool = new EnterTool();
    const result = await tool.execute(
      {
        kind: "qq_group",
      },
      {},
    );

    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVALID_ARGUMENTS",
    });
  });

  it("should reject redundant id when entering zone out", async () => {
    const tool = new EnterTool();
    const result = await tool.execute(
      {
        kind: "zone_out",
        id: "extra",
      },
      {},
    );

    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVALID_ARGUMENTS",
    });
  });
});
