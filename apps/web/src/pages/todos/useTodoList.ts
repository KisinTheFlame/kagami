import { type TodoListQuery } from "@kagami/console-api/todo";
import { useQuery } from "@tanstack/react-query";
import { createHistoryListQueryOptions, queryKeys } from "@/lib/query";
import { consoleClient } from "@/lib/rpc";

type TodoListFilters = Omit<TodoListQuery, "page" | "pageSize">;

export function useTodoList(page: number, pageSize: number, filters: TodoListFilters) {
  const params = {
    page,
    pageSize,
    status: filters.status,
  };

  return useQuery(
    createHistoryListQueryOptions({
      queryKey: queryKeys.todo.historyList(params),
      queryFn: () => consoleClient.queryTodos(params),
    }),
  );
}
