import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { SpireToolComponent } from "./spire-tool-component.js";
import { renderSpireScreen } from "../render/spire-screen.js";
import type { SpireClient } from "../../../../spire/spire-client.js";

export const SPIRE_CHOOSE_TOOL_NAME = "choose";

const Schema = z.object({ option_index: z.number().int().min(0) });

export class SpireChooseTool extends SpireToolComponent<typeof Schema> {
  public readonly name = SPIRE_CHOOSE_TOOL_NAME;
  public readonly description =
    "在地图选路 / 卡奖励 / 篝火等选择界面选一项。option_index 是屏幕上列出的选项编号（从 0 起）。返回选择后的最新状态。";
  public readonly parameters = {
    type: "object",
    properties: {
      option_index: { type: "number", description: "选项编号，从 0 开始。" },
    },
    required: ["option_index"],
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
      type: "choose",
      optionIndex: input.option_index,
    });
    return renderSpireScreen(screen);
  }
}
