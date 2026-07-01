import { z } from "zod";
import {
  ZodToolComponent,
  type AppManager,
  type ToolContext,
  type ToolKind,
} from "@kagami/agent-runtime";
import type { RootAgentSessionController } from "../session/root-agent-session.js";

export const LIST_APPS_TOOL_NAME = "list_apps";

const ListAppsArgumentsSchema = z.object({}).strict();

type ListAppsToolContext = ToolContext & {
  rootAgentSession?: RootAgentSessionController;
};

/**
 * 顶层工具。无参数。列出手机上全部已注册 App 的 id 与名称，并标注当前所在。
 *
 * 手机 OS 模型下 Portal（桌面）只是初始状态、离开后不可返回，因此"有哪些 App"
 * 这件事不能再绑在 Portal 的开机提醒上（离开就没了、压缩后也丢）。list_apps 把
 * App 发现和"当前位置"解耦：在桌面或任何 App 里都能调，永远返回全量名单。
 */
export class ListAppsTool extends ZodToolComponent<typeof ListAppsArgumentsSchema> {
  public readonly name = LIST_APPS_TOOL_NAME;
  public readonly description =
    "列出手机上所有 App 的 id 和名称，任何位置都能调。想知道能切到哪些 App 时用。";
  public readonly parameters = {
    type: "object",
    properties: {},
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = ListAppsArgumentsSchema;

  private readonly appManager: AppManager;

  public constructor({ appManager }: { appManager: AppManager }) {
    super();
    this.appManager = appManager;
  }

  protected async executeTyped(
    _input: z.infer<typeof ListAppsArgumentsSchema>,
    context: ToolContext,
  ): Promise<string> {
    const rootAgentSession = (context as ListAppsToolContext).rootAgentSession;
    const currentApp = rootAgentSession?.getCurrentApp() ?? null;
    const apps = this.appManager.getAllApps().map(app => ({
      id: app.id,
      displayName: app.displayName,
      current: app.id === currentApp,
    }));
    return JSON.stringify({ ok: true, currentApp, apps });
  }
}
