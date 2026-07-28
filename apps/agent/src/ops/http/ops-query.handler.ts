import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { agentApiContract } from "@kagami/agent-api/contract";
import type { AgentInnerThoughtWireItem, AgentTodoWireItem } from "@kagami/agent-api/ops-query";
import type {
  InnerThoughtDao,
  InnerThoughtSummary,
} from "@kagami/persistence/dao/inner-thought.dao";
import type { TodoItemQueryDao, TodoItemRow } from "@kagami/persistence/dao/todo-item.dao";

type OpsQueryHandlerDeps = {
  innerThoughtDao: InnerThoughtDao;
  todoItemDao: TodoItemQueryDao;
};

/**
 * console 只读查询端点（epic #539 子 issue 4）：console 脱库后不再直读主库，agent 持有的
 * inner_thought / todo_item 改经这两条契约路由查询。DB Date → ISO 序列化与
 * legacy 值归一（todo 的 repeatEveryMs<=0 → null）都在数据属主侧完成，console 拿到的
 * 就是 wire 形状、做纯转发聚合。
 *
 * app_log 曾是这里的第三条路由，自 #608 起随表迁到 kagami-observatory。
 */
export class OpsQueryHandler {
  private readonly innerThoughtDao: InnerThoughtDao;
  private readonly todoItemDao: TodoItemQueryDao;

  public constructor({ innerThoughtDao, todoItemDao }: OpsQueryHandlerDeps) {
    this.innerThoughtDao = innerThoughtDao;
    this.todoItemDao = todoItemDao;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, agentApiContract.queryInnerThoughts, async ({ input }) => {
      const [total, items] = await Promise.all([
        this.innerThoughtDao.countByQuery(input),
        this.innerThoughtDao.listPage(input),
      ]);
      return { total, items: items.map(mapInnerThoughtItem) };
    });

    registerJsonRoute(app, agentApiContract.queryTodos, async ({ input }) => {
      const [total, items] = await Promise.all([
        this.todoItemDao.countByQuery(input),
        this.todoItemDao.listPage(input),
      ]);
      return { total, items: items.map(mapTodoItem) };
    });
  }
}

export function mapInnerThoughtItem(item: InnerThoughtSummary): AgentInnerThoughtWireItem {
  return {
    id: item.id,
    triggeredAt: item.triggeredAt.toISOString(),
    outcome: item.outcome,
    thought: item.thought,
    runtimeKey: item.runtimeKey,
    createdAt: item.createdAt.toISOString(),
  };
}

export function mapTodoItem(row: TodoItemRow): AgentTodoWireItem {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    status: row.status,
    remindAt: row.remindAt?.toISOString() ?? null,
    // DB 列是无约束 Int?；把 <=0（legacy / 手工写入）归一成 null，
    // 既符合「0 = 无重复」语义，也保证契约 .positive().nullable() 恒成立，
    // 免得一条坏行让整页只读查询在 output.parse 时 500。
    repeatEveryMs: row.repeatEveryMs !== null && row.repeatEveryMs > 0 ? row.repeatEveryMs : null,
    snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
