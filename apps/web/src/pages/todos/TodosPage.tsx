import { type TodoItem, type TodoItemStatus } from "@kagami/console-api/todo";
import { type FormEvent, useMemo } from "react";
import { HistoryListPageLayout } from "@/components/layout/HistoryListPageLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MobileSelectCard } from "@/components/ui/mobile-select-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useHistoryListPageState } from "@/hooks/useHistoryListPageState";
import { formatOptionalDateTime } from "@/lib/format";
import { cn, truncateText } from "@/lib/utils";
import { TodoDetailPanel } from "./TodoDetailPanel";
import { TODO_STATUSES, toStatusBadgeVariant, toStatusLabel } from "./todo-status";
import { useTodoList } from "./useTodoList";

const PAGE_SIZE = 20;
const ALL_STATUS_VALUE = "__all__";

type FilterFormState = {
  status: "" | TodoItemStatus;
};

export function TodosPage() {
  const {
    isMobile,
    page,
    filters,
    formState,
    setFormState,
    selectedId,
    showMobileDetail,
    handleSelectItem,
    handleBackToList,
    submitFilters,
    resetFilters,
    goToPage,
  } = useHistoryListPageState({
    parseFilters,
    toFormState,
    buildSearchParams,
    createEmptyFormState,
    onSameParamsSubmit: () => {
      void refetch();
    },
  });
  const { data, isLoading, isFetching, isError, refetch } = useTodoList(page, PAGE_SIZE, filters);
  const isInitialLoading = isLoading && !data;
  const total = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = data?.items ?? [];
  const selectedItem = useMemo(
    () => data?.items.find(item => item.id === selectedId) ?? null,
    [data?.items, selectedId],
  );

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitFilters();
  }

  return (
    <HistoryListPageLayout
      filterForm={
        <form
          onSubmit={handleFilterSubmit}
          className={cn("rounded-none border p-4", showMobileDetail && "hidden")}
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">状态</span>
              <Select
                value={formState.status || ALL_STATUS_VALUE}
                onValueChange={value =>
                  setFormState(prev => ({
                    ...prev,
                    status: value === ALL_STATUS_VALUE ? "" : (value as FilterFormState["status"]),
                  }))
                }
              >
                <SelectTrigger aria-label="状态" className="min-w-0 flex-1">
                  <SelectValue placeholder="全部" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_STATUS_VALUE}>全部</SelectItem>
                  {TODO_STATUSES.map(status => (
                    <SelectItem key={status} value={status}>
                      {toStatusLabel(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Button type="submit" size="sm">
              查询
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={resetFilters}>
              重置
            </Button>
          </div>
        </form>
      }
      desktopList={
        <div className="min-h-0 flex-1 overflow-hidden rounded-none border">
          <Table className="min-w-[760px] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>标题</TableHead>
                <TableHead className="w-[96px]">状态</TableHead>
                <TableHead className="w-[160px]">提醒时间</TableHead>
                <TableHead className="w-[160px]">创建时间</TableHead>
                <TableHead className="w-[160px]">完成时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isInitialLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    加载中…
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    暂无数据
                  </TableCell>
                </TableRow>
              ) : (
                items.map(item => (
                  <TableRow
                    key={item.id}
                    data-state={selectedId === item.id ? "selected" : undefined}
                    className="cursor-pointer"
                    onClick={() => handleSelectItem(item.id)}
                  >
                    <TableCell className="truncate text-sm">{item.title}</TableCell>
                    <TableCell>
                      <Badge variant={toStatusBadgeVariant(item.status)}>
                        {toStatusLabel(item.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatOptionalDateTime(item.remindAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatOptionalDateTime(item.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatOptionalDateTime(item.completedAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      }
      mobileList={
        <div className="min-h-0 flex-1 overflow-auto">
          {isInitialLoading ? (
            <div className="flex h-24 items-center justify-center rounded-none border text-sm text-muted-foreground">
              加载中…
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-24 items-center justify-center rounded-none border text-sm text-muted-foreground">
              暂无数据
            </div>
          ) : (
            <div className="space-y-3">
              {items.map(item => (
                <TodoMobileCard
                  key={item.id}
                  item={item}
                  isSelected={selectedId === item.id}
                  onClick={() => handleSelectItem(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      }
      detailPanel={<TodoDetailPanel item={selectedItem} />}
      detailTitle={getDetailTitle(selectedItem)}
      isMobile={isMobile}
      showMobileDetail={showMobileDetail}
      isError={isError}
      page={page}
      total={total}
      totalPages={totalPages}
      isPaginationDisabled={isFetching}
      onPrevPage={() => goToPage(page - 1)}
      onNextPage={() => goToPage(page + 1)}
      onBackToList={handleBackToList}
    />
  );
}

function parseFilters(params: URLSearchParams): { status?: TodoItemStatus } {
  return {
    status: parseStatus(params.get("status")),
  };
}

function toFormState(params: URLSearchParams): FilterFormState {
  return {
    status: parseStatus(params.get("status")) ?? "",
  };
}

function buildSearchParams(formState: FilterFormState): URLSearchParams {
  const nextParams = new URLSearchParams();

  if (formState.status) {
    nextParams.set("status", formState.status);
  }

  return nextParams;
}

function createEmptyFormState(): FilterFormState {
  return {
    status: "",
  };
}

function parseStatus(value: string | null): TodoItemStatus | undefined {
  if (!value) {
    return undefined;
  }

  return TODO_STATUSES.includes(value as TodoItemStatus) ? (value as TodoItemStatus) : undefined;
}

function getDetailTitle(item: TodoItem | null): string {
  if (item === null) {
    return "待办详情";
  }

  return `${toStatusLabel(item.status)} · ${truncateText(item.title, 40)}`;
}

function TodoMobileCard({
  item,
  isSelected,
  onClick,
}: {
  item: TodoItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <MobileSelectCard isSelected={isSelected} onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium">{truncateText(item.title, 140)}</p>
        <Badge variant={toStatusBadgeVariant(item.status)}>{toStatusLabel(item.status)}</Badge>
      </div>

      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
        <p>提醒：{formatOptionalDateTime(item.remindAt)}</p>
        <p>创建：{formatOptionalDateTime(item.createdAt)}</p>
      </div>
    </MobileSelectCard>
  );
}
