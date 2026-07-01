import { z } from "zod";
import { ZodToolComponent, type JsonSchema, type ToolKind } from "../tool/tool-component.js";
import type { AppId, AppManager } from "./app.js";

export const HELP_TOOL_NAME = "help";

const HelpArgumentsSchema = z.object({}).strict();

export type HelpToolDeps = {
  appManager: AppManager;
  /**
   * 由 host（通常是 RootAgentSession）提供，返回 Kagami 当前进入的 App id。
   * 未进入任何 App 时返回 undefined。
   */
  getCurrentApp(): AppId | undefined;
};

/**
 * 顶层工具。无参数。返回当前所在 App 的能力说明。
 *
 * 当 Kagami 不在任何 App 里时，返回提示 "先 switch 进一个 App"。
 */
export class HelpTool extends ZodToolComponent<typeof HelpArgumentsSchema> {
  public readonly name = HELP_TOOL_NAME;
  public readonly description =
    "查询当前所在 App 的能力说明。不在任何 App 里时返回提示。如果不确定当前 App 能做什么，先调这个。";
  public readonly parameters: JsonSchema = {
    type: "object",
    properties: {},
  };
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = HelpArgumentsSchema;

  private readonly deps: HelpToolDeps;

  public constructor(deps: HelpToolDeps) {
    super();
    this.deps = deps;
  }

  protected async executeTyped(): Promise<string> {
    const currentAppId = this.deps.getCurrentApp();
    if (!currentAppId) {
      return "你不在任何 App 里。先用 switch 进入一个 App，再调用 help 查看那个 App 能做什么；想知道有哪些 App 用 list_apps。";
    }
    const app = this.deps.appManager.getApp(currentAppId);
    if (!app) {
      return `当前所在 App "${currentAppId}" 已找不到。可能被卸载或重启过，用 list_apps 看看现在有哪些 App。`;
    }
    return await app.help();
  }
}
