import type { AppStateStore } from "@kagami/agent-runtime";
import type { OccurrenceStore } from "@kagami/scheduler-client/types";

/** app_state 里一个任务 occurrence 去重记录的 appId：存 `{ lastProcessedScheduledAt }`。 */
function occurrenceAppId(taskName: string): string {
  return `scheduler.occurrence.${taskName}`;
}

/**
 * 把通用 app_state 存储适配成 SchedulerClient 要的 OccurrenceStore（issue #428）。按任务名存"已处理
 * 到的 scheduledAt"单值——scheduledAt 单调，去重判据是 incoming <= 已存则跳过（仅 dedupe 任务用，
 * 目前只有 todo:daily-digest）。仿 napcat 游标复用 app_state 表的做法。
 */
export class AppStateOccurrenceStore implements OccurrenceStore {
  private readonly appStateStore: AppStateStore;

  public constructor({ appStateStore }: { appStateStore: AppStateStore }) {
    this.appStateStore = appStateStore;
  }

  public async loadLastProcessed(taskName: string): Promise<string | null> {
    const state = await this.appStateStore.load(occurrenceAppId(taskName));
    if (state !== null && typeof state === "object" && !Array.isArray(state)) {
      const value = (state as Record<string, unknown>).lastProcessedScheduledAt;
      if (typeof value === "string") {
        return value;
      }
    }
    return null;
  }

  public async saveLastProcessed(taskName: string, scheduledAtIso: string): Promise<void> {
    await this.appStateStore.save(occurrenceAppId(taskName), {
      lastProcessedScheduledAt: scheduledAtIso,
    });
  }
}
