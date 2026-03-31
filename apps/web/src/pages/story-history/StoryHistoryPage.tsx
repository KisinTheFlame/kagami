import { type StoryItem } from "@kagami/shared/schemas/story";
import { type FormEvent, useMemo, useState } from "react";
import { HistoryListPageLayout } from "@/components/layout/HistoryListPageLayout";
import { Button } from "@/components/ui/button";
import { MobileSelectCard } from "@/components/ui/mobile-select-card";
import {
  SortableTableHead,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type TableSortDirection,
} from "@/components/ui/table";
import { useHistoryListPageState } from "@/hooks/useHistoryListPageState";
import { normalizeOptionalText, setIfNonEmpty } from "@/lib/search-params";
import { cn, truncateText } from "@/lib/utils";
import { StoryHistoryDetailPanel } from "./StoryHistoryDetailPanel";
import { useStoryList } from "./useStoryList";

const PAGE_SIZE = 20;

type FilterFormState = {
  query: string;
};

export function StoryHistoryPage() {
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
  } = useHistoryListPageState<{ query?: string }, FilterFormState, string>({
    parseFilters,
    toFormState,
    buildSearchParams,
    createEmptyFormState,
    onSameParamsSubmit: () => {
      void refetch();
    },
  });
  const [createdAtSort, setCreatedAtSort] = useState<TableSortDirection>("desc");
  const { data, isLoading, isError, refetch } = useStoryList(page, PAGE_SIZE, filters);
  const total = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = useMemo(() => {
    const baseItems = data?.items ?? [];
    return [...baseItems].sort((left, right) => {
      const leftTime = new Date(left.createdAt).getTime();
      const rightTime = new Date(right.createdAt).getTime();
      return createdAtSort === "asc" ? leftTime - rightTime : rightTime - leftTime;
    });
  }, [createdAtSort, data?.items]);
  const selectedItem = useMemo(
    () => items.find(item => item.id === selectedId) ?? null,
    [items, selectedId],
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
          className={cn("rounded-md border p-4", showMobileDetail && "hidden")}
        >
          <div className="grid grid-cols-1 gap-3">
            <label className="flex flex-col gap-2 text-sm md:flex-row md:items-center md:gap-3">
              <span className="text-muted-foreground md:w-28 md:shrink-0 md:text-right">
                自然语言查询
              </span>
              <input
                value={formState.query}
                onChange={event => setFormState(prev => ({ ...prev, query: event.target.value }))}
                placeholder="例如：闻震承诺给小镜做记忆系统那次讨论"
                className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </label>
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
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
          <Table className="min-w-[920px] table-fixed">
            <TableHeader>
              <TableRow>
                <SortableTableHead
                  label="创建时间"
                  className="w-[180px]"
                  active
                  direction={createdAtSort}
                  onToggle={() =>
                    setCreatedAtSort(current => (current === "desc" ? "asc" : "desc"))
                  }
                />
                <TableHead className="w-[260px]">标题</TableHead>
                <TableHead className="w-[180px]">场景</TableHead>
                <TableHead className="w-[160px]">当前状态</TableHead>
                <TableHead>人物</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
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
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(item.createdAt)}
                    </TableCell>
                    <TableCell className="truncate text-sm font-medium">{item.title}</TableCell>
                    <TableCell className="truncate text-sm text-muted-foreground">
                      {item.scene || "—"}
                    </TableCell>
                    <TableCell className="truncate text-sm text-muted-foreground">
                      {item.status || "—"}
                    </TableCell>
                    <TableCell className="truncate text-sm text-muted-foreground">
                      {item.people.length > 0 ? item.people.join("、") : "—"}
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
          {isLoading ? (
            <div className="flex h-24 items-center justify-center rounded-md border text-sm text-muted-foreground">
              加载中…
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-24 items-center justify-center rounded-md border text-sm text-muted-foreground">
              暂无数据
            </div>
          ) : (
            <div className="space-y-3">
              {items.map(item => (
                <StoryMobileCard
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
      detailPanel={<StoryHistoryDetailPanel item={selectedItem} />}
      detailTitle={selectedItem?.title ?? "记忆详情"}
      isMobile={isMobile}
      showMobileDetail={showMobileDetail}
      isError={isError}
      page={page}
      total={total}
      totalPages={totalPages}
      onPrevPage={() => goToPage(page - 1)}
      onNextPage={() => goToPage(page + 1)}
      onBackToList={handleBackToList}
    />
  );
}

function StoryMobileCard({
  item,
  isSelected,
  onClick,
}: {
  item: StoryItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <MobileSelectCard isSelected={isSelected} onClick={onClick}>
      <div className="space-y-2">
        <div className="text-sm font-medium leading-6">{item.title}</div>
        <div className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</div>
        <div className="text-xs text-muted-foreground">{truncateText(item.scene || "—", 48)}</div>
        <div className="text-xs text-muted-foreground">{truncateText(item.status || "—", 64)}</div>
      </div>
    </MobileSelectCard>
  );
}

function parseFilters(params: URLSearchParams) {
  return {
    query: normalizeOptionalText(params.get("query")),
  };
}

function toFormState(params: URLSearchParams): FilterFormState {
  return {
    query: params.get("query") ?? "",
  };
}

function buildSearchParams(formState: FilterFormState): URLSearchParams {
  const params = new URLSearchParams();
  setIfNonEmpty(params, "query", formState.query);
  return params;
}

function createEmptyFormState(): FilterFormState {
  return {
    query: "",
  };
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
