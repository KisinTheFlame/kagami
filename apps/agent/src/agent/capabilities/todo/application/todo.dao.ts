export type TodoStatus = "pending" | "completed" | "removed";

export type TodoRecord = {
  id: number;
  title: string;
  note: string | null;
  status: TodoStatus;
  remindAt: Date | null;
  repeatEveryMs: number | null;
  snoozedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type CreateTodoInput = {
  title: string;
  note: string | null;
  remindAt: Date | null;
  repeatEveryMs: number | null;
};

export type UpdateTodoFields = {
  title?: string;
  note?: string | null;
  remindAt?: Date | null;
  repeatEveryMs?: number | null;
};

export interface TodoDao {
  /**
   * 在一个事务里先数 pending、未超上限才插入。
   * 返回新行；已达上限返回 "LIMIT_REACHED"。
   */
  createWithinLimit(input: {
    data: CreateTodoInput;
    maxActive: number;
  }): Promise<TodoRecord | "LIMIT_REACHED">;

  findById(input: { id: number }): Promise<TodoRecord | null>;

  /** 列出某状态的待办（按 createdAt 升序），可限制条数。 */
  listByStatus(input: { status: TodoStatus; limit?: number }): Promise<TodoRecord[]>;

  /** pending 总数（用于 digest 的「还有 N 件」与上限判断）。 */
  countByStatus(input: { status: TodoStatus }): Promise<number>;

  /**
   * 查所有「到点且未被 snooze 挡住」的 pending 待办：
   * status='pending' AND remindAt<=now AND (snoozedUntil IS NULL OR snoozedUntil<=now)
   */
  findDueReminders(input: { now: Date }): Promise<TodoRecord[]>;

  /**
   * CAS 续期：仅当行仍是 pending 且 remindAt 等于 expectedRemindAt 时把 remindAt 改为 nextRemindAt。
   * 返回受影响行数（0 表示期间被 agent 改过，本次续期作废）。
   */
  advanceReminder(input: {
    id: number;
    expectedRemindAt: Date;
    nextRemindAt: Date;
  }): Promise<number>;

  /** CAS 清空一次性提醒：条件同上，把 remindAt 置 null。 */
  clearReminder(input: { id: number; expectedRemindAt: Date }): Promise<number>;

  /** 标记完成（仅作用于 pending 行）。返回受影响行数。 */
  markCompleted(input: { id: number; completedAt: Date }): Promise<number>;

  /** soft delete（仅作用于 pending 行）。返回受影响行数。 */
  markRemoved(input: { id: number }): Promise<number>;

  /** 设置 snooze（仅作用于 pending 行）。返回受影响行数。 */
  setSnooze(input: { id: number; snoozedUntil: Date }): Promise<number>;

  /** 改字段（仅作用于 pending 行）。返回受影响行数。 */
  updateFields(input: { id: number; fields: UpdateTodoFields }): Promise<number>;
}
