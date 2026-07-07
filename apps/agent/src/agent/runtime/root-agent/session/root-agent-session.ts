import type { AppId, AppManager } from "@kagami/agent-runtime";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { AgentContext } from "../../context/agent-context.js";
import type { LlmMessage } from "@kagami/llm-client";
import {
  createAsyncToolResultMessage,
  createForegroundInputMessage,
  createInnerThoughtMessage,
  createNotificationMessage,
  createPortalReminderMessage,
} from "../../context/context-message-factory.js";
import type { Event } from "../../event/event.js";
import {
  FOREGROUND_METRIC_DRAIN_EMPTY,
  FOREGROUND_METRIC_INJECT,
  isForegroundInputSource,
  type ForegroundInput,
} from "../foreground-input.js";
import { NOOP_METRIC_CLIENT, type MetricClient } from "@kagami/metric-client/client";

const logger = new AppLogger({ source: "agent.root-session" });

/**
 * 手机 OS 模型下，session 退化为「App 启动器 + 顶层事件路由」：聊天已经 App 化
 * （QqApp 自管会话、订阅 napcat、收消息向 NotificationCenter push 通知），状态树退役。
 *
 * session 只剩：
 * - Portal（桌面）+ currentApp（当前进入的 App）这一个焦点维度；
 * - 顶层事件路由（wake / async_tool_result / notification）——napcat 消息不再走这里，
 *   由 QqApp 直接接收。
 *
 * 聊天目标（send_message 的发送会话）属于 QqApp 的私有概念，由 QqApp 自管，不再经 session
 * 转发。
 */

export type RootAgentPostToolEffects = {
  messages: LlmMessage[];
};

export type RootAgentSessionController = {
  getCurrentApp(): AppId | undefined;
  setCurrentApp(appId: AppId): void;
  /**
   * 标记 root loop 是否已挂起（阻塞在事件队列等下一个生活输入）。由两条挂起路径
   * （wait_for_event effect、纯文本零工具轮）在 await 前后置位，供状态心跳采样读取。
   */
  setSuspended(suspended: boolean): void;
  /**
   * 当前状态桶（互斥单轴）：挂起 → "wait"；否则当前 App id；未进任何 App → "portal"。
   * 供 StateSampler 心跳采样打点。
   */
  getCurrentStateTag(): string;
  /** 本桶上下文里是否进入过该 App（决定 switch 时要不要自动吐 help）。 */
  hasEnteredApp(appId: AppId): boolean;
  /** 标记该 App 本桶已进入。由 switch_app effect 在解释期调用，保持工具无副作用。 */
  markAppEntered(appId: AppId): void;
  /** 清空「已进入 App」集合。上下文压缩时调用，让压缩后首进重新吐 help。 */
  clearEnteredApps(): void;
  reset(): void;
  markRestored(): void;
  initializeContext(): Promise<void>;
  consumeIncomingEvent(event: Event): Promise<{ shouldTriggerRound: boolean }>;
  flushPendingIncomingEffects(): Promise<{ shouldTriggerRound: boolean }>;
  flushPendingPostToolEffects(): Promise<RootAgentPostToolEffects>;
  /**
   * reset 前的失焦广播：调当前 App 的 onBlur（其退化副作用如 center 补推独立于上下文
   * 存活），丢弃返回的 effects——上下文即将整体重建，无处 append。catch 一切错误只记
   * log：reset 是管理台救命操作，绝不因 App bug 阻断。
   */
  blurCurrentApp(): Promise<void>;
};

type RootAgentSessionDeps = {
  context: AgentContext;
  /** Portal 渲染时枚举已注册 Apps 喂给 reminder 消息；也是 foreground_input drain 的 App 查找入口。 */
  appManager?: AppManager;
  /** 前台输入观测计数（inject / drain_empty）。缺省 NOOP。 */
  metricService?: MetricClient;
};

export class RootAgentSession implements RootAgentSessionController {
  private readonly context: AgentContext;
  private readonly appManager: AppManager | null;
  private readonly pendingIncomingMessages: LlmMessage[] = [];
  private readonly pendingPostToolMessages: LlmMessage[] = [];
  private initialized = false;
  /**
   * 当前所在 App id。仅内存持有；不进 snapshot。undefined = Portal（桌面），只在初始
   * 状态出现；一旦 switch 进某个 App 就不再为空（除 reset 重启回到初始）。
   */
  private currentApp: AppId | undefined = undefined;
  /**
   * root loop 是否挂起（阻塞在 eventQueue.waitNonEmpty() 等下一个生活输入 = 空闲）。仅内存
   * 持有；不进 snapshot。两条挂起路径在 await 前后置位（见 root-effect-interpreter 的
   * WaitForEventHandler、root-agent-runtime 的 suspendUntilNextEvent）。reset/markRestored 归位为
   * false（重启后主循环从活跃态重放）。
   */
  private suspended = false;
  /**
   * 本桶上下文里已进入过的 App 集合。仅内存持有；不进 snapshot，生命周期与 currentApp
   * 一致（reset / markRestored 清空）。压缩时由 AppEntryResetExtension 清空，让压缩后首进
   * 重新吐 help。重启后为空——首进各 App 至多重复注入一次 help（有界，见 issue #223）。
   */
  private readonly enteredApps = new Set<AppId>();

  private readonly metricService: MetricClient;

  public constructor({ context, appManager, metricService }: RootAgentSessionDeps) {
    this.context = context;
    this.appManager = appManager ?? null;
    this.metricService = metricService ?? NOOP_METRIC_CLIENT;
  }

  public getCurrentApp(): AppId | undefined {
    return this.currentApp;
  }

  public setCurrentApp(appId: AppId): void {
    this.currentApp = appId;
  }

  public setSuspended(suspended: boolean): void {
    this.suspended = suspended;
  }

  public getCurrentStateTag(): string {
    if (this.suspended) {
      return "wait";
    }
    return this.currentApp ?? "portal";
  }

  public hasEnteredApp(appId: AppId): boolean {
    return this.enteredApps.has(appId);
  }

  public markAppEntered(appId: AppId): void {
    this.enteredApps.add(appId);
  }

  public clearEnteredApps(): void {
    this.enteredApps.clear();
  }

  public reset(): void {
    this.pendingIncomingMessages.splice(0, this.pendingIncomingMessages.length);
    this.pendingPostToolMessages.splice(0, this.pendingPostToolMessages.length);
    this.initialized = false;
    this.currentApp = undefined;
    this.suspended = false;
    this.enteredApps.clear();
  }

  /**
   * 从持久化快照恢复后调用：上下文已含上一会话的 portal reminder，标记 initialized 避免
   * initializeContext 重复追加（会污染稳定前缀、破坏 KV 缓存）。session 自身无持久化状态，
   * 故只重置内存态。
   */
  public markRestored(): void {
    this.pendingIncomingMessages.splice(0, this.pendingIncomingMessages.length);
    this.pendingPostToolMessages.splice(0, this.pendingPostToolMessages.length);
    this.initialized = true;
    this.currentApp = undefined;
    this.suspended = false;
    this.enteredApps.clear();
  }

  public async initializeContext(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.context.appendMessages([createPortalReminderMessage()]);
    this.initialized = true;
  }

  public async consumeIncomingEvent(event: Event): Promise<{ shouldTriggerRound: boolean }> {
    await this.initializeContext();

    if (event.type === "async_tool_result_completed") {
      // 异步工具任务完成：装配成 <async_tool_result> 消息追加到尾部，触发一轮 round。
      this.pendingIncomingMessages.push(createAsyncToolResultMessage(event.data));
      return { shouldTriggerRound: true };
    }

    if (event.type === "notification") {
      // NotificationCenter 聚合后塞进队列的统一通知（手机 OS 模型）。装配成一条
      // <notification> 消息追加到尾部，触发一轮 round。
      this.pendingIncomingMessages.push(createNotificationMessage(event.data.lines));
      return { shouldTriggerRound: true };
    }

    if (event.type === "foreground_input") {
      // 前台输入敲门：事件不带内容，向当前前台 App 现拉。拉空（stale 敲门 / 焦点漂移 /
      // 前序事件已消费）即 no-op——多次敲门幂等。
      const input = await this.drainForegroundInput();
      if (input === null) {
        return { shouldTriggerRound: false };
      }
      this.pendingIncomingMessages.push(createForegroundInputMessage(input.text));
      return { shouldTriggerRound: true };
    }

    if (event.type === "inner_thought") {
      // 内心独白（issue #265）：装配成 <inner_thought> 消息追加到尾部，触发一轮 round。
      this.pendingIncomingMessages.push(createInnerThoughtMessage(event.data.thought));
      return { shouldTriggerRound: true };
    }

    // wake：纯唤醒标记，session 不做事。napcat 消息 / friend_list 不再走 session
    // （由 QqApp 直接接收），万一到这里也忽略。
    return { shouldTriggerRound: false };
  }

  public async blurCurrentApp(): Promise<void> {
    const appId = this.currentApp;
    const app = appId ? this.appManager?.getApp(appId) : undefined;
    if (!app?.onBlur) {
      return;
    }
    try {
      await app.onBlur();
    } catch (error) {
      // 吞错只记 log：reset 不能被 App 的 onBlur bug 阻断。App 侧约定 onBlur 第一行
      // 同步翻焦点标志，因此即使退化补推抛错，焦点也已归位。
      logger.errorWithCause(`App "${appId}" onBlur 在 reset 失焦广播中抛错，已忽略`, error, {
        event: "agent.root_session.blur_on_reset_failed",
        appId,
      });
    }
  }

  /**
   * 向当前前台 App 拉取待注入的前台输入。三重防御：App 不存在 / 未实现该能力 → null；
   * App 自查失焦 → null；App drain 抛错 → 记 log 后视同拉空（App 侧「先渲染后消费」
   * 保证此时输入仍在其缓冲中，不丢）。绝不让 App bug 打崩主循环。
   */
  private async drainForegroundInput(): Promise<ForegroundInput | null> {
    const appId = this.currentApp;
    const app = appId ? this.appManager?.getApp(appId) : undefined;
    if (!app || !isForegroundInputSource(app)) {
      this.recordForegroundMetric(FOREGROUND_METRIC_DRAIN_EMPTY, 1);
      return null;
    }
    try {
      const input = await app.drainForegroundInput();
      if (input === null || input.text.length === 0) {
        this.recordForegroundMetric(FOREGROUND_METRIC_DRAIN_EMPTY, 1);
        return null;
      }
      this.recordForegroundMetric(FOREGROUND_METRIC_INJECT, input.itemCount);
      return input;
    } catch (error) {
      logger.errorWithCause(`App "${appId}" drainForegroundInput 抛错，视同拉空`, error, {
        event: "agent.root_session.foreground_drain_failed",
        appId,
      });
      this.recordForegroundMetric(FOREGROUND_METRIC_DRAIN_EMPTY, 1);
      return null;
    }
  }

  private recordForegroundMetric(metricName: string, value: number): void {
    // fire-and-forget：metric 摄取失败只丢点，不影响主循环。
    void this.metricService
      .record({ metricName, value, tags: { runtime: "agent" } })
      .catch(() => undefined);
  }

  public async flushPendingIncomingEffects(): Promise<{ shouldTriggerRound: boolean }> {
    await this.initializeContext();

    const shouldTriggerRound = this.pendingIncomingMessages.length > 0;
    if (this.pendingIncomingMessages.length > 0) {
      await this.context.appendMessages(this.pendingIncomingMessages);
      this.pendingIncomingMessages.splice(0, this.pendingIncomingMessages.length);
    }
    return { shouldTriggerRound };
  }

  public async flushPendingPostToolEffects(): Promise<RootAgentPostToolEffects> {
    await this.initializeContext();
    return {
      messages: this.pendingPostToolMessages.splice(0, this.pendingPostToolMessages.length),
    };
  }
}
