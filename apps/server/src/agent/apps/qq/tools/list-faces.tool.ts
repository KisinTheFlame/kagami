import { z } from "zod";
import { ZodToolComponent, type ToolKind } from "@kagami/agent-runtime";
import { QQ_FACE_NAMES } from "../../../../napcat/service/napcat-gateway/qq-face-names.js";

const ListFacesArgumentsSchema = z.object({});

/**
 * 列出所有可发送的 QQ 内置表情名字。小镜自己只见过群友发过的表情，想发别的得知道名字——
 * 这个工具把可发送全集（从兜底字典派生）摊给他按需查阅。发送仍走 send_message 文本里的
 * `[表情: 名字]` 标记，名字必须和这里列出的完全一致才会被还原成表情段。
 */
export class ListFacesTool extends ZodToolComponent<typeof ListFacesArgumentsSchema> {
  public readonly name = "list_faces";
  public readonly description =
    "列出所有可发送的 QQ 内置表情名字。想发表情但不确定有哪些 / 名字怎么写时调它查全集；" +
    "发送时在 send_message 文本里写 `[表情: 名字]`（如 `[表情: 比心]`），名字要和列表里的完全一致。";
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = ListFacesArgumentsSchema;

  protected async executeTyped(): Promise<string> {
    const names = Object.values(QQ_FACE_NAMES);
    return [
      `可发送的 QQ 内置表情共 ${names.length} 个。在 send_message 文本里写 [表情: 名字] 发送，例如 [表情: 比心]。`,
      "",
      names.join("、"),
    ].join("\n");
  }
}
