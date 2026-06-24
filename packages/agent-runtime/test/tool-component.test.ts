import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ZodToolComponent } from "../src/tool/tool-component.js";
import type {
  JsonSchema,
  ToolContext,
  ToolExecutionResult,
  ToolKind,
} from "../src/tool/tool-component.js";

const echoSchema = z.object({ value: z.string() });

const ECHO_PARAMETERS: JsonSchema = {
  type: "object",
  properties: { value: { type: "string" } },
};

/** 记录 executeTyped 是否被调用、以何种输入调用，用来验证参数校验门控。 */
class EchoTool extends ZodToolComponent<typeof echoSchema> {
  public readonly name = "echo";
  public readonly description = "echo back the value";
  public readonly parameters: JsonSchema = ECHO_PARAMETERS;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = echoSchema;

  public typedCalls: Array<z.infer<typeof echoSchema>> = [];

  protected executeTyped(input: z.infer<typeof echoSchema>): string {
    this.typedCalls.push(input);
    return `echo:${input.value}`;
  }
}

class StructuredTool extends ZodToolComponent<typeof echoSchema> {
  public readonly name = "structured";
  public readonly description = "returns a structured result";
  public readonly parameters: JsonSchema = ECHO_PARAMETERS;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = echoSchema;

  protected executeTyped(): ToolExecutionResult {
    return {
      content: "done",
      effects: [{ type: "switch_app" }],
    };
  }
}

class ThrowingTool extends ZodToolComponent<typeof echoSchema> {
  public readonly name = "throwing";
  public readonly description = "always throws";
  public readonly parameters: JsonSchema = ECHO_PARAMETERS;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = echoSchema;

  protected executeTyped(): string {
    throw new Error("kaboom");
  }
}

const EMPTY_CONTEXT: ToolContext = {};

describe("ZodToolComponent", () => {
  it("参数校验不通过时绝不调用 executeTyped，返回 INVALID_ARGUMENTS", async () => {
    const tool = new EchoTool();

    const result = await tool.execute({ value: 123 }, EMPTY_CONTEXT);

    expect(tool.typedCalls).toHaveLength(0);
    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: "INVALID_ARGUMENTS",
    });
  });

  it("参数合法时调用 executeTyped，string 返回值被包成 { content }", async () => {
    const tool = new EchoTool();

    const result = await tool.execute({ value: "hi" }, EMPTY_CONTEXT);

    expect(tool.typedCalls).toEqual([{ value: "hi" }]);
    expect(result).toEqual({ content: "echo:hi" });
  });

  it("executeTyped 返回结构化结果时原样透传（含 effects）", async () => {
    const tool = new StructuredTool();

    const result = await tool.execute({ value: "hi" }, EMPTY_CONTEXT);

    expect(result).toEqual({
      content: "done",
      effects: [{ type: "switch_app" }],
    });
  });

  it("executeTyped 抛错被接住并转成结构化错误，而不是冒泡打断 loop", async () => {
    const tool = new ThrowingTool();

    const result = await tool.execute({ value: "hi" }, EMPTY_CONTEXT);

    expect(JSON.parse(result.content)).toEqual({
      ok: false,
      error: "kaboom",
    });
  });
});
