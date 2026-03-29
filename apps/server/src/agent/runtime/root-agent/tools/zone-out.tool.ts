import { z } from "zod";
import { ZodToolComponent, type ToolKind } from "@kagami/agent-runtime";

export const ZONE_OUT_TOOL_NAME = "zone_out";

const ZoneOutArgumentsSchema = z.object({
  thought: z.string().trim().min(1),
});

export class ZoneOutTool extends ZodToolComponent<typeof ZoneOutArgumentsSchema> {
  public readonly name = ZONE_OUT_TOOL_NAME;
  public readonly description = "在神游状态里记录一段当下的思路，不产生外部副作用。";
  public readonly parameters = {
    type: "object",
    properties: {
      thought: {
        type: "string",
        description: "这次神游里想的内容。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = ZoneOutArgumentsSchema;

  protected async executeTyped(input: z.infer<typeof ZoneOutArgumentsSchema>): Promise<string> {
    return JSON.stringify({
      ok: true,
      thought: input.thought,
      message: "这次神游想法已记录。你可以继续神游，或者回到门户。",
    });
  }
}
