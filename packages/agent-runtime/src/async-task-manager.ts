import { randomUUID } from "node:crypto";

/**
 * 异步任务的终态结果。成功带 content（给 LLM 看的字符串），失败带 message，
 * 超时不带正文（manager 级安全超时触发）。
 */
export type AsyncTaskOutcome =
  | { readonly status: "success"; readonly content: string }
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
  /** 可注入，便于测试确定性；默认 node:crypto randomUUID。 */
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

  public constructor({ onComplete, maxTaskDurationMs, generateId }: AsyncTaskManagerDeps) {
    this.onComplete = onComplete;
    this.maxTaskDurationMs = maxTaskDurationMs;
    this.generateId = generateId ?? (() => randomUUID());
  }

  public submit(input: { toolName: string; run: () => Promise<string> }): { taskId: string } {
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
        const content = await input.run();
        clearTimeout(timer);
        finish({ status: "success", content });
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
