import type { ToolComponent } from "../tool/tool-component.js";

/** App 的唯一标识符。 */
export type AppId = string;

/**
 * App 是 Kagami "手机" 上的一个能力单元。每个 App 自带一组 invoke 子工具、
 * 可选的生命周期钩子，以及一个能力说明（help）。
 *
 * 框架不窥探 App 内部状态。所有 view focus、缓存、计时器等都由 App 自己管理。
 *
 * 设计依据见仓库根 CLAUDE.md "工具组织：InvokeTool 是顶层工具集的稳定壳"。
 */
export interface App {
  /** 唯一短串识别符，用作 Registry key 与外部 enter 目标 id。 */
  readonly id: AppId;

  /** 给 Kagami 看的人类可读短名，例如 "计算器"。在 Portal 列出 App 时使用。 */
  readonly displayName: string;

  /**
   * 这个 App 贡献给 InvokeTool 的子工具集合。
   *
   * 固定数组，运行期不变。LLM 工具定义在 startup 时一次性确定，遵循 KV 缓存
   * 友好的"稳定前缀"原则。
   */
  readonly tools: readonly ToolComponent[];

  /**
   * 由 AppManager 在分发某个本 App 拥有的工具之前调用。
   * 返回 false 表示 "这个工具我虽然拥有，但当前不该被调"。
   *
   * Phase 1 大多数实现可以直接 `return true`。view 切换等更细粒度的检查
   * 在 Phase 2 之后由各 App 自行决定。
   */
  canInvoke(toolName: string): boolean;

  /**
   * 当 Kagami 调用 help 工具且当前进入了本 App 时被调用。
   * 应返回工具使用说明（不含状态）。
   */
  help(): Promise<string>;

  /** 进程启动时调用一次。App 可以在这里做初始化 / 起后台 timer。 */
  onStartup?(): Promise<void>;

  /** 进程关停时反向调用一次。App 应在这里清理 timer / 连接。 */
  onShutdown?(): Promise<void>;
}

/** AppManager.canInvoke 的返回。 */
export type CanInvokeResult = { ok: true } | { ok: false; reason: string };

/**
 * AppManager 持有所有已注册的 App 实例，是 InvokeTool / HelpTool 等顶层工具
 * 查询 "这个工具属于哪个 App / 现在能不能调" 的唯一入口。
 *
 * AppManager 自己不持有 "当前所在 App" 状态。currentApp 由调用方（通常是
 * RootAgentSession）持有并以参数形式传入。
 */
export class AppManager {
  private readonly apps = new Map<AppId, App>();
  private readonly toolOwners = new Map<string, App>();

  /** 注册一个 App。同 id 重复注册会抛错。 */
  public register(app: App): void {
    if (this.apps.has(app.id)) {
      throw new Error(`App "${app.id}" 已注册`);
    }
    for (const tool of app.tools) {
      const existing = this.toolOwners.get(tool.name);
      if (existing) {
        throw new Error(
          `工具名 "${tool.name}" 已被 App "${existing.id}" 占用，App "${app.id}" 不能再声明同名工具`,
        );
      }
    }
    this.apps.set(app.id, app);
    for (const tool of app.tools) {
      this.toolOwners.set(tool.name, app);
    }
  }

  public getApp(id: AppId): App | undefined {
    return this.apps.get(id);
  }

  public getAllApps(): readonly App[] {
    return [...this.apps.values()];
  }

  /**
   * 给 InvokeTool 用：判断 toolName 是否被某个注册过的 App 拥有。
   *
   * 返回 true → 该工具的可用性完全由 AppManager.canInvoke 决定，跳过状态树
   *            availableTools 检查（App 工具不存在于状态树视野里）
   * 返回 false → 该工具是状态树时代的旧工具，走原状态树 availableTools 判
   */
  public ownsTool(toolName: string): boolean {
    return this.toolOwners.has(toolName);
  }

  /**
   * 给 InvokeTool 用：判断 toolName 是否可以在 currentApp 下被调用。
   *
   * 调用前提：调用方已经通过 ownsTool 确认 toolName 属于某 App。
   *
   * 规则：
   * 1. 不属于任何注册过的 App → ok（理论上不会走到这里，调用方应先用 ownsTool 判）
   * 2. 属于某 App，但 Kagami 不在该 App → not ok，返回提示
   * 3. 属于当前 App，但 App 自己说 "不能调" → not ok
   */
  public canInvoke(toolName: string, currentApp: AppId | undefined): CanInvokeResult {
    const owner = this.toolOwners.get(toolName);
    if (!owner) {
      return { ok: true };
    }
    if (currentApp !== owner.id) {
      return {
        ok: false,
        reason: `工具 "${toolName}" 属于 "${owner.id}" App，需先 enter("${owner.id}") 才能调用。`,
      };
    }
    if (!owner.canInvoke(toolName)) {
      return {
        ok: false,
        reason: `工具 "${toolName}" 在 "${owner.id}" App 的当前状态下不可用。`,
      };
    }
    return { ok: true };
  }

  /** 顺序调用所有 App 的 onStartup。 */
  public async startupAll(): Promise<void> {
    for (const app of this.apps.values()) {
      await app.onStartup?.();
    }
  }

  /** 反向调用所有 App 的 onShutdown。 */
  public async shutdownAll(): Promise<void> {
    const reversed = [...this.apps.values()].reverse();
    for (const app of reversed) {
      await app.onShutdown?.();
    }
  }
}
