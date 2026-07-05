import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { SpireToolComponent } from "./spire-tool-component.js";
import { renderSpireScreen } from "../render/spire-screen.js";
import type { SpireClient } from "../../../../acl/spire-client.js";

const SPIRE_START_RUN_TOOL_NAME = "start_run";

const Schema = z.object({
  character: z.enum(["ironclad", "silent", "defect", "watcher"]).optional(),
});

export class SpireStartRunTool extends SpireToolComponent<typeof Schema> {
  public readonly name = SPIRE_START_RUN_TOOL_NAME;
  public readonly description =
    "开始一局新的尖塔爬塔（若已有对局会以新局覆盖）。可选 character 选角色：ironclad（铁甲战士，力量/格挡）、silent（静默猎手，中毒/飞刀）、defect（故障机器人，充能球）、watcher（静心观者，姿态）；不填默认铁甲战士。返回开局战况。";
  public readonly parameters = {
    type: "object",
    properties: {
      character: {
        type: "string",
        enum: ["ironclad", "silent", "defect", "watcher"],
        description:
          "角色：ironclad 铁甲战士 / silent 静默猎手 / defect 故障机器人 / watcher 静心观者。默认 ironclad。",
      },
    },
    required: [],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getSpireClient: () => SpireClient;

  public constructor({ getSpireClient }: { getSpireClient: () => SpireClient }) {
    super();
    this.getSpireClient = getSpireClient;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<string> {
    return renderSpireScreen(await this.getSpireClient().startRun(input.character));
  }
}
