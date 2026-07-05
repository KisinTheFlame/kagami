import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { SpireToolComponent } from "./spire-tool-component.js";
import { renderSpireScreen } from "../render/spire-screen.js";
import type { SpireClient } from "../../../../acl/spire-client.js";

const SPIRE_PLAY_CARD_TOOL_NAME = "play_card";

const Schema = z.object({
  hand_index: z.number().int().min(0),
  target_index: z.number().int().min(0).nullish(),
});

export class SpirePlayCardTool extends SpireToolComponent<typeof Schema> {
  public readonly name = SPIRE_PLAY_CARD_TOOL_NAME;
  public readonly description =
    "打出一张手牌。hand_index 是手牌编号（从 0 起）；攻击类牌需用 target_index 指定敌人编号（从 0 起）。返回出牌后的战况。";
  public readonly parameters = {
    type: "object",
    properties: {
      hand_index: { type: "number", description: "手牌编号，从 0 开始。" },
      target_index: { type: "number", description: "敌人编号，从 0 开始；仅攻击类牌需要。" },
    },
    required: ["hand_index"],
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
      type: "play_card",
      handIndex: input.hand_index,
      targetIndex: input.target_index ?? null,
    });
    return renderSpireScreen(screen);
  }
}
