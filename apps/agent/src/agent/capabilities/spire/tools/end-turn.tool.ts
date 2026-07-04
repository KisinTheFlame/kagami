import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { SpireToolComponent } from "./spire-tool-component.js";
import { renderSpireScreen } from "../render/spire-screen.js";
import type { SpireClient } from "../../../../acl/spire-client.js";

export const SPIRE_END_TURN_TOOL_NAME = "end_turn";

const Schema = z.object({});

export class SpireEndTurnTool extends SpireToolComponent<typeof Schema> {
  public readonly name = SPIRE_END_TURN_TOOL_NAME;
  public readonly description =
    "结束本回合，让所有敌人按意图行动，然后进入你的下一回合。返回敌人行动后的战况。";
  public readonly parameters = { type: "object", properties: {}, required: [] } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getSpireClient: () => SpireClient;

  public constructor({ getSpireClient }: { getSpireClient: () => SpireClient }) {
    super();
    this.getSpireClient = getSpireClient;
  }

  protected async executeTyped(): Promise<string> {
    return renderSpireScreen(await this.getSpireClient().act({ type: "end_turn" }));
  }
}
