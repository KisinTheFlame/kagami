import { z } from "zod";
import { ZodToolComponent, type JsonSchema, type ToolKind } from "../tool/tool-component.js";
import type { AppId, AppManager } from "./app.js";

export const HELP_TOOL_NAME = "help";

const HelpArgumentsSchema = z.object({}).strict();

export type HelpToolDeps = {
  appManager: AppManager;
  /** 由 host 提供，返回当前进入的 App id；未进入任何 App 时返回 undefined。 */
  getCurrentApp(): AppId | undefined;
  /**
   * 不在任何 App 里时返回的提示文案。「怎么进入一个 App」是 host 的导航语义（工具名
   * 因 host 而异），内核不认识，故整段文案由 host 注入。
   */
  notInAppHint: string;
  /** 当前 App 已找不到（被卸载 / 重启）时返回的提示文案，参数是丢失的 appId。由 host 提供。 */
  appNotFoundHint(appId: AppId): string;
};

/**
 * 顶层工具。无参数。返回当前所在 App 的能力说明；不在任何 App 里、或当前 App 已
 * 找不到时，返回由 host 注入的提示文案（内核不写死具体导航工具名）。
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
      return this.deps.notInAppHint;
    }
    const app = this.deps.appManager.getApp(currentAppId);
    if (!app) {
      return this.deps.appNotFoundHint(currentAppId);
    }
    return await app.help();
  }
}
