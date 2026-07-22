import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { GbaToolComponent } from "./gba-tool-component.js";
import { GbaError } from "../domain/errors.js";
import type { GbaClient } from "../../../../acl/gba-client.js";

const GBA_LOAD_GAME_TOOL_NAME = "load_game";

const Schema = z.object({
  name: z.string().min(1),
});

export class GbaLoadGameTool extends GbaToolComponent<typeof Schema> {
  public readonly name = GBA_LOAD_GAME_TOOL_NAME;
  public readonly description =
    "插卡带开机：按名称加载卡带库里的游戏（名称要与 list_games 列出的完全一致）。会从开机画面冷启动，电池存档自动带上；当前若插着别的游戏会先存档再换。加载后用 screenshot 看开机画面。";
  public readonly parameters = {
    type: "object",
    properties: {
      name: { type: "string", description: "游戏名称，与 list_games 列出的完全一致。" },
    },
    required: ["name"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getGbaClient: () => GbaClient;

  public constructor({ getGbaClient }: { getGbaClient: () => GbaClient }) {
    super();
    this.getGbaClient = getGbaClient;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<string> {
    const client = this.getGbaClient();
    const roms = await client.listRoms();
    const rom = roms.find(candidate => candidate.name === input.name);
    if (!rom) {
      throw new GbaError(
        "GBA_REJECTED",
        `卡带库里没有「${input.name}」；现有：${roms.map(r => r.name).join("、") || "（空）"}`,
      );
    }
    const loaded = await client.loadGame(rom.id);
    // 响应按「她看了有什么用」裁剪:timelineId 是诊断元数据,不进她的上下文。
    return JSON.stringify({
      ok: true,
      romName: loaded.romName,
      hasSave: rom.hasSave,
    });
  }
}
