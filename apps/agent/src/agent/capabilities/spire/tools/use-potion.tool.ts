import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { SpireToolComponent } from "./spire-tool-component.js";
import { renderSpireScreen } from "../render/spire-screen.js";
import type { SpireClient } from "../../../../spire/spire-client.js";

export const SPIRE_USE_POTION_TOOL_NAME = "use_potion";

const Schema = z.object({
  slot_index: z.number().int().min(0),
  target_index: z.number().int().min(0).nullish(),
});

export class SpireUsePotionTool extends SpireToolComponent<typeof Schema> {
  public readonly name = SPIRE_USE_POTION_TOOL_NAME;
  public readonly description =
    "使用一瓶药水。slot_index 是药水槽编号（从 0 起）；施加到敌人的药水（火焰/虚弱/恐惧）需用 target_index 指定敌人编号。药水用后消失。返回使用后的战况。";
  public readonly parameters = {
    type: "object",
    properties: {
      slot_index: { type: "number", description: "药水槽编号，从 0 开始。" },
      target_index: { type: "number", description: "敌人编号，从 0 开始；仅指向敌人的药水需要。" },
    },
    required: ["slot_index"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getSpireClient: () => SpireClient;

  public constructor({ getSpireClient }: { getSpireClient: () => SpireClient }) {
    super();
    this.getSpireClient = getSpireClient;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<string> {
    const screen = await this.getSpireClient().act({
      type: "use_potion",
      slotIndex: input.slot_index,
      targetIndex: input.target_index ?? null,
    });
    return renderSpireScreen(screen);
  }
}
