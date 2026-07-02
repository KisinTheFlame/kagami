import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { SpireToolComponent } from "./spire-tool-component.js";
import { renderSpireScreen } from "../render/spire-screen.js";
import type { SpireClient } from "../../../../spire/spire-client.js";

export const SPIRE_START_RUN_TOOL_NAME = "start_run";

const Schema = z.object({});

export class SpireStartRunTool extends SpireToolComponent<typeof Schema> {
  public readonly name = SPIRE_START_RUN_TOOL_NAME;
  public readonly description =
    "开始一局新的尖塔爬塔（若已有对局会以新局覆盖）。返回开局第一场战斗的战况。";
  public readonly parameters = { type: "object", properties: {}, required: [] } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getSpireClient: () => SpireClient;

  public constructor({ getSpireClient }: { getSpireClient: () => SpireClient }) {
    super();
    this.getSpireClient = getSpireClient;
  }

  protected async executeTyped(): Promise<string> {
    return renderSpireScreen(await this.getSpireClient().startRun());
  }
}
