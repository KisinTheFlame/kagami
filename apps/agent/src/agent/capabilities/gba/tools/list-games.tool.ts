import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { GbaToolComponent } from "./gba-tool-component.js";
import type { GbaClient } from "../../../../acl/gba-client.js";

const GBA_LIST_GAMES_TOOL_NAME = "list_games";

const Schema = z.object({});

export class GbaListGamesTool extends GbaToolComponent<typeof Schema> {
  public readonly name = GBA_LIST_GAMES_TOOL_NAME;
  public readonly description =
    "看卡带库里有哪些游戏（名称 / 大小 / 有没有存档 / 上次玩的时间），以及当前插着哪一盘。";
  public readonly parameters = { type: "object", properties: {}, required: [] } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getGbaClient: () => GbaClient;

  public constructor({ getGbaClient }: { getGbaClient: () => GbaClient }) {
    super();
    this.getGbaClient = getGbaClient;
  }

  protected async executeTyped(): Promise<string> {
    const client = this.getGbaClient();
    const [roms, state] = await Promise.all([client.listRoms(), client.state()]);
    return JSON.stringify({
      ok: true,
      games: roms.map(rom => ({
        name: rom.name,
        sizeBytes: rom.sizeBytes,
        hasSave: rom.hasSave,
        lastPlayedAt: rom.lastPlayedAt,
      })),
      current: state.loaded
        ? { name: state.romName, foreground: state.foreground, frame: state.frame }
        : null,
    });
  }
}
