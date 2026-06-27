import { MAX_ACTIVE_TODOS, MIN_REPEAT_MS } from "./todo.constants.js";
import { InvalidTimeError, parseDuration, parseTimePoint } from "./parse-reminder-time.js";
import type { TodoDao, TodoRecord, TodoStatus } from "./todo.dao.js";

export type TodoListFilter = "pending" | "all" | "done";

export type DueReminder = { id: number; title: string };

export type DigestSummary = {
  /** pending 总数（含被截断未列出的）。 */
  totalCount: number;
  /** 列出的条目（已封顶）。 */
  items: { id: number; title: string }[];
};

export type AddTodoResult = { ok: true; todo: TodoRecord } | { ok: false; error: "LIMIT_REACHED" };

type TodoServiceDeps = {
  todoDao: TodoDao;
  /** 注入「现在」便于测试；缺省用 `() => new Date()`。 */
  now?: () => Date;
};

/**
 * TODO capability 的业务层：CRUD + 到期收集（含 O(1) 取模续期与 CAS）+ digest 汇总。
 *
 * 不持有任何 NotificationDraft / App 概念——到期/汇总都以纯数据返回，由上层（poller
 * 回调 → server-runtime）构造 Draft 并 push。
 */
export class TodoService {
  private readonly todoDao: TodoDao;
  private readonly now: () => Date;

  public constructor({ todoDao, now }: TodoServiceDeps) {
    this.todoDao = todoDao;
    this.now = now ?? (() => new Date());
  }

  /** 记一条待办。非法时间抛 InvalidTimeError；撞上限返回 LIMIT_REACHED。 */
  public async addTodo(input: {
    title: string;
    note?: string;
    remindAt?: string;
    repeatEvery?: string;
  }): Promise<AddTodoResult> {
    const now = this.now();
    const remindAt = input.remindAt ? parseTimePoint(input.remindAt, now) : null;
    const repeatEveryMs = input.repeatEvery ? this.parseRepeat(input.repeatEvery) : null;
    if (remindAt && remindAt.getTime() <= now.getTime()) {
      throw new InvalidTimeError("remindAt 必须是未来时刻");
    }

    const created = await this.todoDao.createWithinLimit({
      data: {
        title: input.title,
        note: input.note ?? null,
        remindAt,
        repeatEveryMs,
      },
      maxActive: MAX_ACTIVE_TODOS,
    });
    if (created === "LIMIT_REACHED") {
      return { ok: false, error: "LIMIT_REACHED" };
    }
    return { ok: true, todo: created };
  }

  /**
   * 给 list_todos / onFocus 用的视图：按 filter 取条目（已封顶）+ 总数 + 标题。
   * - pending（默认）：未完成项。
   * - done：已完成项。
   * - all：未完成 + 已完成（不含 removed），各自封顶后合并再封顶。
   */
  public async listView(input: {
    filter: TodoListFilter;
    limit: number;
  }): Promise<{ todos: TodoRecord[]; total: number; heading: string }> {
    if (input.filter === "all") {
      const [pending, completed, pendingCount, completedCount] = await Promise.all([
        this.todoDao.listByStatus({ status: "pending", limit: input.limit }),
        this.todoDao.listByStatus({ status: "completed", limit: input.limit }),
        this.todoDao.countByStatus({ status: "pending" }),
        this.todoDao.countByStatus({ status: "completed" }),
      ]);
      const total = pendingCount + completedCount;
      return {
        todos: [...pending, ...completed].slice(0, input.limit),
        total,
        heading: `全部待办（${total} 件）`,
      };
    }
    const status: TodoStatus = input.filter === "done" ? "completed" : "pending";
    const [todos, total] = await Promise.all([
      this.todoDao.listByStatus({ status, limit: input.limit }),
      this.todoDao.countByStatus({ status }),
    ]);
    const heading = status === "pending" ? `未完成待办（${total} 件）` : `已完成（${total} 件）`;
    return { todos, total, heading };
  }

  /** 标记完成。返回是否命中（pending 行存在）。 */
  public async completeTodo(input: { id: number }): Promise<boolean> {
    const affected = await this.todoDao.markCompleted({ id: input.id, completedAt: this.now() });
    return affected > 0;
  }

  /** soft delete。返回是否命中。 */
  public async removeTodo(input: { id: number }): Promise<boolean> {
    const affected = await this.todoDao.markRemoved({ id: input.id });
    return affected > 0;
  }

  /** 稍后再提醒。恰好给一个 until/forMinutes；过去时刻/非正数抛 InvalidTimeError。 */
  public async snoozeTodo(input: {
    id: number;
    until?: string;
    forMinutes?: number;
  }): Promise<boolean> {
    const now = this.now();
    const snoozedUntil = this.resolveSnoozeUntil(input, now);
    if (snoozedUntil.getTime() <= now.getTime()) {
      throw new InvalidTimeError("snooze 目标时刻必须在未来");
    }
    const affected = await this.todoDao.setSnooze({ id: input.id, snoozedUntil });
    return affected > 0;
  }

  /** 改字段（仅 pending）。非法时间抛 InvalidTimeError；返回是否命中。 */
  public async updateTodo(input: {
    id: number;
    title?: string;
    note?: string;
    remindAt?: string;
    repeatEvery?: string;
  }): Promise<boolean> {
    const now = this.now();
    const fields: {
      title?: string;
      note?: string | null;
      remindAt?: Date | null;
      repeatEveryMs?: number | null;
    } = {};
    if (input.title !== undefined) {
      fields.title = input.title;
    }
    if (input.note !== undefined) {
      fields.note = input.note;
    }
    if (input.remindAt !== undefined) {
      const remindAt = parseTimePoint(input.remindAt, now);
      if (remindAt.getTime() <= now.getTime()) {
        throw new InvalidTimeError("remindAt 必须是未来时刻");
      }
      fields.remindAt = remindAt;
    }
    if (input.repeatEvery !== undefined) {
      fields.repeatEveryMs = this.parseRepeat(input.repeatEvery);
    }
    const affected = await this.todoDao.updateFields({ id: input.id, fields });
    return affected > 0;
  }

  /**
   * 收集所有到点提醒并就地续期/清空（CAS）。返回每条到点项的 {id,title} 给上层 push。
   *
   * 续期用 O(1) 取模严格推过 now（不 while，防停机后追赶式连刷）；续期 UPDATE 用 CAS
   * （仅当行仍 pending 且 remindAt 等于读到的原值才生效），避免覆盖 agent 期间的 snooze/改期。
   */
  public async collectDueReminders(): Promise<DueReminder[]> {
    const now = this.now();
    const due = await this.todoDao.findDueReminders({ now });
    const result: DueReminder[] = [];
    for (const todo of due) {
      if (todo.remindAt === null) {
        continue; // 防御：findDueReminders 不该返回 remindAt 为 null 的行
      }
      result.push({ id: todo.id, title: todo.title });
      if (todo.repeatEveryMs !== null) {
        const next = computeNextRemindAt(todo.remindAt, todo.repeatEveryMs, now);
        await this.todoDao.advanceReminder({
          id: todo.id,
          expectedRemindAt: todo.remindAt,
          nextRemindAt: next,
        });
      } else {
        await this.todoDao.clearReminder({ id: todo.id, expectedRemindAt: todo.remindAt });
      }
    }
    return result;
  }

  /** 给每日 digest 用的未完成项汇总（已封顶）。 */
  public async buildDigest(input: { limit: number }): Promise<DigestSummary> {
    const totalCount = await this.todoDao.countByStatus({ status: "pending" });
    const rows = await this.todoDao.listByStatus({ status: "pending", limit: input.limit });
    return {
      totalCount,
      items: rows.map(row => ({ id: row.id, title: row.title })),
    };
  }

  private parseRepeat(repeatEvery: string): number {
    const ms = parseDuration(repeatEvery);
    if (ms < MIN_REPEAT_MS) {
      throw new InvalidTimeError(`repeatEvery 不能小于 ${MIN_REPEAT_MS / 1000} 秒`);
    }
    return ms;
  }

  private resolveSnoozeUntil(input: { until?: string; forMinutes?: number }, now: Date): Date {
    const hasUntil = input.until !== undefined;
    const hasForMinutes = input.forMinutes !== undefined;
    if (hasUntil === hasForMinutes) {
      throw new InvalidTimeError("snooze 需且仅需提供 until 或 forMinutes 之一");
    }
    if (hasUntil) {
      return parseTimePoint(input.until as string, now);
    }
    const minutes = input.forMinutes as number;
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new InvalidTimeError("forMinutes 必须为正数");
    }
    return new Date(now.getTime() + minutes * 60_000);
  }
}

/**
 * O(1) 取模算出严格大于 now 的下一次提醒时刻。
 *
 * periods = floor((now - base) / repeat) + 1，保证 base + periods*repeat 严格 > now，
 * 即便 now 恰好落在周期边界上也多推一个周期，避免当拍重复触发。
 */
export function computeNextRemindAt(remindAt: Date, repeatEveryMs: number, now: Date): Date {
  const base = remindAt.getTime();
  const nowMs = now.getTime();
  if (base > nowMs) {
    return remindAt;
  }
  const elapsed = nowMs - base;
  const periods = Math.floor(elapsed / repeatEveryMs) + 1;
  return new Date(base + periods * repeatEveryMs);
}
