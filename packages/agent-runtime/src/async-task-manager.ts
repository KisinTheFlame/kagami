/**
 * 异步任务成功时可携带的图片块。结构级类型（裸 base64 + mime + 可选文件名），刻意不引
 * `@kagami/llm` 的 `LlmImageContentPart`——内核保持通用、不耦合具体 LLM 内容模型；生成方
 * 在回流装配时把它映射成多模态 content part（见 apps/agent 的 createAsyncToolResultMessage）。
 */
export type AsyncTaskImage = {
  readonly content: string;
  readonly mimeType: string;
  readonly filename?: string;
};

/**
 * `run` thunk 的返回值：纯文本（string，向后兼容原有工具）或带图的结构。带图时结果回流会拼成
 * 多模态消息，让主 Agent「看见」异步产物（如生图）。
 */
export type AsyncTaskRunResult =
  | string
  | { readonly content: string; readonly images?: readonly AsyncTaskImage[] };

/**
 * 异步任务的终态结果。成功带 content（给 LLM 看的字符串）+ 可选 images（多模态块），失败带
 * message，超时不带正文（manager 级安全超时触发）。
 */
export type AsyncTaskOutcome =
  | {
      readonly status: "success";
      readonly content: string;
      readonly images?: readonly AsyncTaskImage[];
    }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "timeout" };

/** 一个异步任务完成时回调给生成方的完整信息。 */
export type AsyncTaskCompletion = {
  readonly taskId: string;
  readonly toolName: string;
  readonly outcome: AsyncTaskOutcome;
};

export type AsyncTaskManagerDeps = {
  /**
   * 完成回调，成功/错误/超时各**恰好一次**。生成方负责把它接到事件队列
   * （例如 enqueue 一个 AsyncToolResultCompletedEvent）。约定轻量、不抛错。
   */
  onComplete: (completion: AsyncTaskCompletion) => void;
  /**
   * manager 级安全超时；任务超过此时长以 timeout outcome 回流（底层 run 仍可能在跑，
   * 但其晚到 settle 会被丢弃）。是「无 cancel 工具」前提下唯一的兜底。
   */
  maxTaskDurationMs: number;
  /** 可注入，便于测试确定性；默认「进程前缀+自增序号」（短、避免 UUID 噪声，又跨进程不重号）。 */
  generateId?: () => string;
};

/**
 * 通用异步任务原语：把一段后台工作（`run` thunk）登记在册、立即返回 taskId，
 * 后台跑完/出错/超时时通过 `onComplete` 回调**恰好一次**。
 *
 * 纯通用、不携带任何项目语义：不认识事件队列、session、占位/回流消息格式。
 * 那些都由生成方在 `onComplete` 里接线。
 *
 * 不变量：
 * - `submit` 同步返回，绝不 await `run`（解放调用方）。
 * - 每个任务 `onComplete` 恰好一次：success / error / timeout 三选一。
 * - 超时回流后，`run` 的晚到 settle 被吞掉，不产生 unhandled rejection，也不触发第二次回调。
 * - 无并发上限；`inFlightCount` 仅供观测，任务 settle 后从在飞集合移除。
 */
export class AsyncTaskManager {
  private readonly onComplete: (completion: AsyncTaskCompletion) => void;
  private readonly maxTaskDurationMs: number;
  private readonly generateId: () => string;
  private readonly inFlight = new Set<string>();
  // 每进程随机前缀 + 进程内自增序号：短（远小于 36 字符 UUID，少占她上下文），又能跨进程/重启
  // 区分——避免旧会话残留的 <async_task_submitted> 占位符与新任务序号视觉重号（异步任务纯内存、
  // 不跨重启恢复，活任务本就不会碰撞，这里进一步消掉重启后残留占位的歧义）。
  private readonly idPrefix = Math.random().toString(36).slice(2, 5);
  private nextTaskSeq = 1;

  public constructor({ onComplete, maxTaskDurationMs, generateId }: AsyncTaskManagerDeps) {
    this.onComplete = onComplete;
    this.maxTaskDurationMs = maxTaskDurationMs;
    this.generateId = generateId ?? (() => `${this.idPrefix}-${this.nextTaskSeq++}`);
  }

  public submit(input: { toolName: string; run: () => Promise<AsyncTaskRunResult> }): {
    taskId: string;
  } {
    const taskId = this.generateId();
    this.inFlight.add(taskId);

    let settled = false;

    // 一次性完成（恰好一次）。超时直接调它；run 路径先 clearTimeout 再调它。
    const finish = (outcome: AsyncTaskOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      this.inFlight.delete(taskId);
      try {
        this.onComplete({ taskId, toolName: input.toolName, outcome });
      } catch {
        // onComplete 约定轻量、不抛错；万一抛了也吞掉，不影响其它任务。
      }
    };

    const timer = setTimeout(() => finish({ status: "timeout" }), this.maxTaskDurationMs);

    // 不 await：后台跑。晚到的 settle（含超时后才 reject）由 settled 守卫吞掉，
    // reject 在此 catch 内被捕获，不会冒泡成 unhandled rejection。
    void (async () => {
      try {
        const result = await input.run();
        clearTimeout(timer);
        // 归一化 run 的返回：纯 string → {content}；带图结构原样透传 images（空数组不落）。
        const success: AsyncTaskOutcome =
          typeof result === "string"
            ? { status: "success", content: result }
            : {
                status: "success",
                content: result.content,
                ...(result.images && result.images.length > 0 ? { images: result.images } : {}),
              };
        finish(success);
      } catch (error) {
        clearTimeout(timer);
        finish({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return { taskId };
  }

  public inFlightCount(): number {
    return this.inFlight.size;
  }
}
