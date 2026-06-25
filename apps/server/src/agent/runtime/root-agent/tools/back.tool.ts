import { z } from "zod";
import { ZodToolComponent, type ToolKind } from "@kagami/agent-runtime";

export const BACK_TOOL_NAME = "back";

const BackArgumentsSchema = z.object({});

/**
 * 手机 OS 模型下聊天状态树已退役，桌面（Portal）下没有可逐级 back 的子状态；退出
 * App 用 back_to_portal。这里保留工具壳只为顶层工具集稳定，恒返提示。
 */
export class BackTool extends ZodToolComponent<typeof BackArgumentsSchema> {
  public readonly name = BACK_TOOL_NAME;
  public readonly description =
    "返回上一级。当前桌面下没有可逐级返回的子状态；要退出 App 回桌面请用 back_to_portal。";
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = BackArgumentsSchema;

  protected async executeTyped(): Promise<string> {
    return JSON.stringify({
      ok: false,
      error: "NO_PARENT_STATE",
      message: "桌面下没有可逐级返回的子状态。要退出当前 App 回桌面，请用 back_to_portal。",
    });
  }
}
