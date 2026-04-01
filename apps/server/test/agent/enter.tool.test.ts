import { describe, expect, it } from "vitest";
import { EnterTool } from "../../src/agent/runtime/root-agent/tools/enter.tool.js";

describe("enter tool", () => {
  it("should enter child state by id", async () => {
    const tool = new EnterTool();
    const result = await tool.execute(
      {
        id: "qq_group:group-1",
      },
      {
        rootAgentSession: {
          enter: async (input: { id: string }) => ({
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
      id: "qq_group:group-1",
    });
  });

  it("should reject missing id", async () => {
    const tool = new EnterTool();
    const result = await tool.execute({}, {});

    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVALID_ARGUMENTS",
    });
  });
});
