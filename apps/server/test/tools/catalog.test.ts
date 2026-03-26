import { describe, expect, it, vi } from "vitest";
import { ToolCatalog } from "../../src/tools/index.js";
import type { ToolComponent } from "../../src/tools/index.js";

function createToolComponent(name: string): ToolComponent {
  return {
    name,
    description: name,
    parameters: {
      type: "object",
      properties: {},
    },
    kind: "business",
    llmTool: {
      name,
      description: name,
      parameters: {
        type: "object",
        properties: {},
      },
    },
    execute: vi.fn().mockResolvedValue({
      content: name,
      signal: "continue",
    }),
  };
}

describe("ToolCatalog", () => {
  it("should throw when tool names are duplicated", () => {
    expect(() => new ToolCatalog([createToolComponent("dup"), createToolComponent("dup")])).toThrow(
      "Tool name is duplicated: dup",
    );
  });

  it("should pick tools in requested order", () => {
    const catalog = new ToolCatalog([
      createToolComponent("search_web"),
      createToolComponent("send_message"),
      createToolComponent("finish"),
    ]);

    const toolSet = catalog.pick(["finish", "search_web"]);

    expect(toolSet.definitions()).toEqual([
      {
        name: "finish",
        description: "finish",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "search_web",
        description: "search_web",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    ]);
  });

  it("should throw when a picked tool is not registered", () => {
    const catalog = new ToolCatalog([createToolComponent("search_web")]);

    expect(() => catalog.pick(["search_web", "finish"])).toThrow("Tool is not registered: finish");
  });

  it("should execute tools and expose their kind", async () => {
    const catalog = new ToolCatalog([
      createToolComponent("search_web"),
      {
        name: "finish",
        description: "finish",
        parameters: {
          type: "object",
          properties: {},
        },
        kind: "control",
        llmTool: {
          name: "finish",
          description: "finish",
          parameters: {
            type: "object",
            properties: {},
          },
        },
        execute: vi.fn().mockResolvedValue({
          content: "",
          signal: "finish_round",
        }),
      },
    ]);

    const toolSet = catalog.pick(["finish"]);

    await expect(toolSet.execute("finish", {}, {})).resolves.toEqual({
      kind: "control",
      content: "",
      signal: "finish_round",
    });
  });
});
