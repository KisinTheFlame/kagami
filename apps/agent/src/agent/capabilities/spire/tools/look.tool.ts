import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { SpireToolComponent } from "./spire-tool-component.js";
import { renderSpireScreen, renderSpireNoRun } from "../render/spire-screen.js";
import type { SpireClient } from "../../../../acl/spire-client.js";

export const SPIRE_LOOK_TOOL_NAME = "look";

const Schema = z.object({});

export class SpireLookTool extends SpireToolComponent<typeof Schema> {
  public readonly name = SPIRE_LOOK_TOOL_NAME;
  public readonly description =
    "重新查看当前战况（不消耗任何动作）。没有进行中的对局时会提示你开局。";
  public readonly parameters = { type: "object", properties: {}, required: [] } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getSpireClient: () => SpireClient;

  public constructor({ getSpireClient }: { getSpireClient: () => SpireClient }) {
    super();
    this.getSpireClient = getSpireClient;
  }

  protected async executeTyped(): Promise<string> {
    const screen = await this.getSpireClient().getState();
    return screen ? renderSpireScreen(screen) : renderSpireNoRun();
  }
}
