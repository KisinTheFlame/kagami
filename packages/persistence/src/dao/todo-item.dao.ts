export type TodoItemStatus = "pending" | "completed" | "removed";

export type TodoItemRow = {
  id: number;
  title: string;
  note: string | null;
  status: TodoItemStatus;
  remindAt: Date | null;
  repeatEveryMs: number | null;
  snoozedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type QueryTodoItemListInput = {
  page: number;
  pageSize: number;
  status?: TodoItemStatus;
};

/**
 * Todo 的只读查询 DAO：供 console（管理台后端）分页展示 todo_item 用。
 *
 * 注意与 agent 侧 `TodoDao`（capabilities/todo）区分——那个 DAO 承载 agent 的读写
 * 业务（限额插入 / CAS 续期 / 完成 / soft delete），属 agent 私有；console 只需只读
 * 分页，故这里在 @kagami/persistence 单独提供一个零业务的查询接口，两者各连同一张表。
 */
export interface TodoItemQueryDao {
  /** 按 status 过滤后的总数（status 省略则全量）。 */
  countByQuery(input: QueryTodoItemListInput): Promise<number>;

  /** 分页列出（按 createdAt 倒序，id 倒序兜稳定次序）；status 省略则全量。 */
  listPage(input: QueryTodoItemListInput): Promise<TodoItemRow[]>;
}
