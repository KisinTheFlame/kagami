import { z } from "zod";
import { ZodToolComponent, type JsonSchema, type ToolKind } from "@kagami/agent-runtime";
import { BEIJING_TIME_ZONE } from "@kagami/shared/utils";

export const VIEW_TIME_TOOL_NAME = "view_time";

const ViewTimeArgumentsSchema = z.object({});

/**
 * 查看当前北京时间（精确到秒）。Clock App 内唯一的工具。
 *
 * - 无参数
 * - 返回 JSON 字符串 { ok: true, time: "YYYY 年 M 月 D 日 HH:MM:SS", timezone: "Asia/Shanghai" }
 * - 时区强制为 Asia/Shanghai，与 wake reminder（context-message-factory.ts）保持一致
 */
export class ViewTimeTool extends ZodToolComponent<typeof ViewTimeArgumentsSchema> {
  public readonly name = VIEW_TIME_TOOL_NAME;
  public readonly description = "查看当前北京时间（精确到秒）。";
  public readonly parameters: JsonSchema = {
    type: "object",
    properties: {},
  };
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = ViewTimeArgumentsSchema;

  protected async executeTyped(): Promise<string> {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone: BEIJING_TIME_ZONE,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const time = `${values.year} 年 ${values.month} 月 ${values.day} 日 ${values.hour}:${values.minute}:${values.second}`;

    return JSON.stringify({ ok: true, time, timezone: BEIJING_TIME_ZONE });
  }
}
