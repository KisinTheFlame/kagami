import { contractUrl } from "@kagami/http/url";
import { consoleApiContract } from "@kagami/console-api/contract";
import { TodoListResponseSchema, type TodoListQuery } from "@kagami/console-api/todo";
import { useQuery } from "@tanstack/react-query";
import { createHistoryListQueryOptions, queryKeys } from "@/lib/query";

type TodoListFilters = Omit<TodoListQuery, "page" | "pageSize">;

export function useTodoList(page: number, pageSize: number, filters: TodoListFilters) {
  const params = {
    page: String(page),
    pageSize: String(pageSize),
    status: filters.status,
  } satisfies Record<string, string | undefined>;

  return useQuery(
    createHistoryListQueryOptions({
      queryKey: queryKeys.todo.historyList(params),
      path: contractUrl(consoleApiContract.queryTodos),
      schema: TodoListResponseSchema,
      params,
    }),
  );
}
