import { z } from "zod";
import type { ToolKind } from "@kagami/agent-runtime";
import { GbaToolComponent } from "./gba-tool-component.js";
import type { GbaClient } from "../../../../acl/gba-client.js";

const GBA_IMPORT_ROM_TOOL_NAME = "import_rom";

const Schema = z.object({
  resid: z.string().min(1),
  name: z.string().min(1).max(200),
});

export class GbaImportRomTool extends GbaToolComponent<typeof Schema> {
  public readonly name = GBA_IMPORT_ROM_TOOL_NAME;
  public readonly description =
    "把一个已在 OSS 里的 GBA ROM（比如别人发给你、经群文件收下的 .gba，拿到了 resid）收进卡带库。字节由服务端直接搬运校验（是不是真 GBA ROM / 大小 / 去重），不经过你的上下文。收好后就能 load_game 玩了。";
  public readonly parameters = {
    type: "object",
    properties: {
      resid: { type: "string", description: "OSS 资源 id（res-<数字>），指向 .gba 文件字节。" },
      name: { type: "string", description: "给这盘卡带起的名字（唯一，之后 load_game 用它）。" },
    },
    required: ["resid", "name"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = Schema;
  private readonly getGbaClient: () => GbaClient;

  public constructor({ getGbaClient }: { getGbaClient: () => GbaClient }) {
    super();
    this.getGbaClient = getGbaClient;
  }

  protected async executeTyped(input: z.infer<typeof Schema>): Promise<string> {
    const rom = await this.getGbaClient().importRom({ resId: input.resid, name: input.name });
    // 响应按「她看了有什么用」裁剪:sha256/字节数是校验痕迹,属于服务端日志。
    return JSON.stringify({ ok: true, name: rom.name });
  }
}
