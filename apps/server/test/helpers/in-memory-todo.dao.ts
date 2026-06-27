import type {
  CreateTodoInput,
  TodoDao,
  TodoRecord,
  TodoStatus,
  UpdateTodoFields,
} from "../../src/agent/capabilities/todo/application/todo.dao.js";

/**
 * 测试用内存 TodoDao，忠实复刻 PrismaTodoDao 的语义：
 * - createWithinLimit 数 pending、未超才插入
 * - CAS：advance/clearReminder 仅当行仍 pending 且 remindAt 等于 expected 才生效
 * - 状态变更（complete/remove/snooze/update）仅作用于 pending 行
 */
export class InMemoryTodoDao implements TodoDao {
  public readonly rows = new Map<number, TodoRecord>();
  public failFindDueOnce = false;
  private nextId = 1;
  private readonly now: () => Date;

  public constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  public async createWithinLimit(input: {
    data: CreateTodoInput;
    maxActive: number;
  }): Promise<TodoRecord | "LIMIT_REACHED"> {
    const pending = [...this.rows.values()].filter(r => r.status === "pending").length;
    if (pending >= input.maxActive) {
      return "LIMIT_REACHED";
    }
    const id = this.nextId++;
    const at = this.now();
    const record: TodoRecord = {
      id,
      title: input.data.title,
      note: input.data.note,
      status: "pending",
      remindAt: input.data.remindAt,
      repeatEveryMs: input.data.repeatEveryMs,
      snoozedUntil: null,
      createdAt: at,
      updatedAt: at,
      completedAt: null,
    };
    this.rows.set(id, record);
    return { ...record };
  }

  public async findById(input: { id: number }): Promise<TodoRecord | null> {
    const row = this.rows.get(input.id);
    return row ? { ...row } : null;
  }

  public async listByStatus(input: { status: TodoStatus; limit?: number }): Promise<TodoRecord[]> {
    const list = [...this.rows.values()]
      .filter(r => r.status === input.status)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
    const sliced = input.limit !== undefined ? list.slice(0, input.limit) : list;
    return sliced.map(r => ({ ...r }));
  }

  public async countByStatus(input: { status: TodoStatus }): Promise<number> {
    return [...this.rows.values()].filter(r => r.status === input.status).length;
  }

  public async findDueReminders(input: { now: Date }): Promise<TodoRecord[]> {
    if (this.failFindDueOnce) {
      this.failFindDueOnce = false;
      throw new Error("forced findDueReminders failure");
    }
    const due = [...this.rows.values()].filter(
      r =>
        r.status === "pending" &&
        r.remindAt !== null &&
        r.remindAt.getTime() <= input.now.getTime() &&
        (r.snoozedUntil === null || r.snoozedUntil.getTime() <= input.now.getTime()),
    );
    due.sort(
      (a, b) => (a.remindAt as Date).getTime() - (b.remindAt as Date).getTime() || a.id - b.id,
    );
    return due.map(r => ({ ...r }));
  }

  public async advanceReminder(input: {
    id: number;
    expectedRemindAt: Date;
    nextRemindAt: Date;
  }): Promise<number> {
    const row = this.rows.get(input.id);
    if (
      !row ||
      row.status !== "pending" ||
      row.remindAt === null ||
      row.remindAt.getTime() !== input.expectedRemindAt.getTime()
    ) {
      return 0;
    }
    row.remindAt = input.nextRemindAt;
    row.updatedAt = this.now();
    return 1;
  }

  public async clearReminder(input: { id: number; expectedRemindAt: Date }): Promise<number> {
    const row = this.rows.get(input.id);
    if (
      !row ||
      row.status !== "pending" ||
      row.remindAt === null ||
      row.remindAt.getTime() !== input.expectedRemindAt.getTime()
    ) {
      return 0;
    }
    row.remindAt = null;
    row.updatedAt = this.now();
    return 1;
  }

  public async markCompleted(input: { id: number; completedAt: Date }): Promise<number> {
    const row = this.rows.get(input.id);
    if (!row || row.status !== "pending") {
      return 0;
    }
    row.status = "completed";
    row.completedAt = input.completedAt;
    row.updatedAt = this.now();
    return 1;
  }

  public async markRemoved(input: { id: number }): Promise<number> {
    const row = this.rows.get(input.id);
    if (!row || row.status !== "pending") {
      return 0;
    }
    row.status = "removed";
    row.updatedAt = this.now();
    return 1;
  }

  public async setSnooze(input: { id: number; snoozedUntil: Date }): Promise<number> {
    const row = this.rows.get(input.id);
    if (!row || row.status !== "pending") {
      return 0;
    }
    row.snoozedUntil = input.snoozedUntil;
    row.updatedAt = this.now();
    return 1;
  }

  public async updateFields(input: { id: number; fields: UpdateTodoFields }): Promise<number> {
    const row = this.rows.get(input.id);
    if (!row || row.status !== "pending") {
      return 0;
    }
    if (input.fields.title !== undefined) {
      row.title = input.fields.title;
    }
    if (input.fields.note !== undefined) {
      row.note = input.fields.note;
    }
    if (input.fields.remindAt !== undefined) {
      row.remindAt = input.fields.remindAt;
    }
    if (input.fields.repeatEveryMs !== undefined) {
      row.repeatEveryMs = input.fields.repeatEveryMs;
    }
    row.updatedAt = this.now();
    return 1;
  }
}
