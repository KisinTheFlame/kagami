import type { z } from "zod";
import type { Effect } from "../effect.js";
import type { ToolComponent } from "../tool/tool-component.js";

/** App 的唯一标识符。 */
export type AppId = string;

/** JSON 可序列化值——App 持久化状态的载体类型（契约：必须能 JSON 往返）。 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * App 状态存储端口。内核不认识具体存储（Prisma / 文件 / 内存）——由宿主注入实现。
 *
 * 按 appId 存取一份**不透明 JSON**：状态的形状与版本由各 App 自己拥有（restoreState
 * 内部自行判版本、不认就忽略）。AppManager 在 startup 时 load → restoreState、shutdown
 * 时 exportState → save。这条侧路与消息列表 / 稳定前缀完全无关，对 KV 缓存中性。
 */
export interface AppStateStore {
  load(appId: AppId): Promise<JsonValue | null>;
  save(appId: AppId, state: JsonValue): Promise<void>;
}

/**
 * App 是 Kagami "手机" 上的一个能力单元。每个 App 自带一组 invoke 子工具、
 * 可选的生命周期钩子，以及一个能力说明（help）。
 *
 * 框架不窥探 App 内部状态。所有 view focus、缓存、计时器等都由 App 自己管理。
 *
 * 设计依据见仓库根 CLAUDE.md "工具组织：InvokeTool 是顶层工具集的稳定壳"。
 *
 * 泛型参数 TConfig 让 App 可以声明自己的配置 schema（zod），框架在 startup
 * 时按 schema 解析 `config.apps.<id>` 段落，并把验证后的强类型 config 传给
 * onStartup。无 config 的 App 使用默认 TConfig=void，onStartup 拿到的
 * config 是 undefined。
 */
export interface App<TConfig = void> {
  /** 唯一短串识别符，用作 Registry key 与外部 switch 目标 id。 */
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
   * App 自己的配置 schema。框架在 startup 时按 `config.apps.<id>` 段落解析。
   * 缺省（schema 未声明）时表示 App 不需要 config，onStartup 的 ctx.config
   * 为 undefined。
   *
   * 解析失败会在 startup 阶段抛错并附 App id，避免运行时才发现配置错误。
   */
  // 输入侧用 unknown：rawAppsConfig 的切片是 unknown，且允许 z.object().default({})
  // 这类 schema（输入侧带 undefined）作为合法的 configSchema 写法。
  readonly configSchema?: z.ZodType<TConfig, z.ZodTypeDef, unknown>;

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

  /**
   * 进程启动时调用一次。App 可以在这里做初始化 / 起后台 timer。
   * ctx.config 是按 configSchema 解析后的强类型配置；未声明 schema 的 App
   * 拿到的是 undefined。
   */
  onStartup?(ctx: AppStartupContext<TConfig>): Promise<void>;

  /** 进程关停时反向调用一次。App 应在这里清理 timer / 连接。 */
  onShutdown?(): Promise<void>;

  /**
   * 进入本 App 时调用（焦点切换为本 App）。
   *
   * 返回的 Effect[] 由 root agent 的 EffectInterpreter 解释执行——通常包含
   * 一个 `append_message` Effect，把 App 进入时要展示的"屏幕"内容追加到上下文
   * 尾部。
   *
   * 由导航工具（SwitchTool）在 switch_app Effect 之后展开调用：先产 switch_app
   * Effect 切焦点、再调本钩子拿 Effect[] 拼进自己的 effects 列表。
   *
   * 设计依据：[docs/effect-model.md](docs/effect-model.md)。
   */
  onFocus?(): Promise<readonly Effect[]>;

  /** 离开本 App 时调用（焦点切到另一个 App）。 */
  onBlur?(): Promise<readonly Effect[]>;

  /**
   * 交出本 App 要持久化的状态（纯 JSON）。由 AppManager 在 shutdown 时调用，存进
   * AppStateStore。未实现表示本 App 无需持久化状态。状态形状 + 版本由 App 自己拥有。
   */
  exportState?(): JsonValue;

  /**
   * 启动时把上次存档塞回来（先于 onStartup 调用）。App 自行校验 / 迁移；拿到不认识的
   * 形状应安全忽略，而不是抛错。未实现表示本 App 不消费持久化状态。
   */
  restoreState?(state: JsonValue): void;
}

/** App.onStartup 的入参，目前只含解析后的配置。未来可能扩展（logger / 共享服务等）。 */
export interface AppStartupContext<TConfig = void> {
  readonly config: TConfig;
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
  // 内部存的是 App<unknown>，泛型擦除。各 App 实例自己负责 TConfig 的类型安全。
  private readonly apps = new Map<AppId, App<unknown>>();
  private readonly toolOwners = new Map<string, App<unknown>>();
  /** App 状态持久化端口；缺省（无宿主注入）时持久化整体是 no-op。 */
  private readonly stateStore: AppStateStore | null;

  public constructor({ stateStore }: { stateStore?: AppStateStore } = {}) {
    this.stateStore = stateStore ?? null;
  }

  /** 注册一个 App。同 id 重复注册会抛错。 */
  public register<TConfig>(app: App<TConfig>): void {
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
    const erased = app as App<unknown>;
    this.apps.set(app.id, erased);
    for (const tool of app.tools) {
      this.toolOwners.set(tool.name, erased);
    }
  }

  public getApp(id: AppId): App<unknown> | undefined {
    return this.apps.get(id);
  }

  public getAllApps(): readonly App<unknown>[] {
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
        reason: `工具 "${toolName}" 属于 "${owner.id}" App，需先 switch("${owner.id}") 才能调用。`,
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

  /**
   * 顺序调用所有 App 的 onStartup，并按 configSchema 解析对应配置切片。
   *
   * rawAppsConfig 通常来自 config.yaml 的 `server.apps` 段落（结构 unknown，
   * 由 App 自己的 schema 校验）。某 App 不在 raw 里时按空对象处理，让 schema
   * 的默认值生效。
   *
   * 校验失败的 App 会以包含 App id 的错误信息抛出，避免运行时才发现配置错误。
   */
  public async startupAll(rawAppsConfig: Record<string, unknown> = {}): Promise<void> {
    for (const app of this.apps.values()) {
      const raw = rawAppsConfig[app.id] ?? {};
      let config: unknown = undefined;
      if (app.configSchema) {
        const parsed = app.configSchema.safeParse(raw);
        if (!parsed.success) {
          throw new Error(
            `App "${app.id}" 配置不合法（config.apps.${app.id}）：${parsed.error.message}`,
          );
        }
        config = parsed.data;
      }
      // 存档先于 onStartup：让 App 在初始化前就拿回上次状态。
      await this.restoreAppState(app);
      // App<unknown> 的 onStartup 期望 ctx.config: unknown，cast 是必要的。
      // 每个 App 自己的 TConfig 类型由它的实现保证（register<TConfig> 时类型已校验）。
      await app.onStartup?.({ config });
    }
  }

  /** 反向调用所有 App 的 onShutdown，并在拆解前抓取各 App 的状态存档。 */
  public async shutdownAll(): Promise<void> {
    const reversed = [...this.apps.values()].reverse();
    for (const app of reversed) {
      // 先抓状态（此时 App 仍是活的），再 onShutdown 拆解。
      await this.persistAppState(app);
      await app.onShutdown?.();
    }
  }

  /** 启动时从 store 读回 App 状态并 restoreState。失败不阻断启动（降级为空状态）。 */
  private async restoreAppState(app: App<unknown>): Promise<void> {
    if (!this.stateStore || !app.restoreState) {
      return;
    }
    try {
      const state = await this.stateStore.load(app.id);
      if (state !== null) {
        app.restoreState(state);
      }
    } catch {
      // 恢复失败不应阻断启动；App 以空状态继续。
    }
  }

  /** 关停时把 App 的 exportState 存进 store。失败不阻断关停。 */
  private async persistAppState(app: App<unknown>): Promise<void> {
    if (!this.stateStore || !app.exportState) {
      return;
    }
    try {
      await this.stateStore.save(app.id, app.exportState());
    } catch {
      // 存档失败不应阻断关停。
    }
  }
}
