import type { OssObjectSummary } from "@kagami/oss-api/oss-object";
import { type FormEvent, useMemo } from "react";
import { HistoryListPageLayout } from "@/components/layout/HistoryListPageLayout";
import { Button } from "@/components/ui/button";
import { MobileSelectCard } from "@/components/ui/mobile-select-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useHistoryListPageState } from "@/hooks/useHistoryListPageState";
import { formatBytes, formatDateTime } from "@/lib/format";
import { normalizeOptionalText, setIfNonEmpty } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { OssObjectDetailPanel } from "./OssObjectDetailPanel";
import { OssStatsBanner } from "./OssStatsBanner";
import { type OssObjectListFilters, useOssObjectList } from "./useOssObjectList";

const PAGE_SIZE = 20;

type FilterFormState = {
  mime: string;
};

export function OssObjectsPage() {
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
  } = useHistoryListPageState<OssObjectListFilters, FilterFormState, string>({
    parseFilters,
    toFormState,
    buildSearchParams,
    createEmptyFormState,
    onSameParamsSubmit: () => {
      void refetch();
    },
  });
  const { data, isLoading, isFetching, isError, refetch } = useOssObjectList(
    page,
    PAGE_SIZE,
    filters,
  );
  const isInitialLoading = isLoading && !data;
  const total = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const selectedSummary = useMemo(
    () => items.find(item => item.key === selectedId) ?? null,
    [items, selectedId],
  );

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitFilters();
  }

  return (
    <HistoryListPageLayout
      filterForm={
        <div className={cn("flex flex-col gap-3", showMobileDetail && "hidden")}>
          <OssStatsBanner />
          <form onSubmit={handleFilterSubmit} className="rounded-none border p-4">
            <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">类型</span>
              <input
                type="text"
                aria-label="mime 类型"
                placeholder="如 image/png，留空为全部"
                value={formState.mime}
                onChange={event => setFormState(prev => ({ ...prev, mime: event.target.value }))}
                className="min-w-0 flex-1 rounded-none border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
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
        </div>
      }
      desktopList={
        <div className="min-h-0 flex-1 overflow-hidden rounded-none border">
          <Table className="min-w-[680px] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[190px]">时间</TableHead>
                <TableHead className="w-[110px]">Key</TableHead>
                <TableHead>类型</TableHead>
                <TableHead className="w-[110px]">大小</TableHead>
                <TableHead className="w-[80px]">引用</TableHead>
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
                    key={item.key}
                    data-state={selectedId === item.key ? "selected" : undefined}
                    className="cursor-pointer"
                    onClick={() => handleSelectItem(item.key)}
                  >
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDateTime(item.createdAt)}
                    </TableCell>
                    <TableCell className="truncate font-mono text-sm">{item.key}</TableCell>
                    <TableCell className="truncate text-sm">{item.mime}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatBytes(item.size)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{item.refcount}</TableCell>
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
                <OssObjectMobileCard
                  key={item.key}
                  item={item}
                  isSelected={selectedId === item.key}
                  onClick={() => handleSelectItem(item.key)}
                />
              ))}
            </div>
          )}
        </div>
      }
      detailPanel={<OssObjectDetailPanel summary={selectedSummary} />}
      detailTitle={selectedSummary ? selectedSummary.key : "OSS 对象详情"}
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

function parseFilters(params: URLSearchParams): OssObjectListFilters {
  return {
    mime: normalizeOptionalText(params.get("mime")),
  };
}

function toFormState(params: URLSearchParams): FilterFormState {
  return {
    mime: params.get("mime") ?? "",
  };
}

function buildSearchParams(formState: FilterFormState): URLSearchParams {
  const nextParams = new URLSearchParams();
  setIfNonEmpty(nextParams, "mime", formState.mime);
  return nextParams;
}

function createEmptyFormState(): FilterFormState {
  return {
    mime: "",
  };
}

function OssObjectMobileCard({
  item,
  isSelected,
  onClick,
}: {
  item: OssObjectSummary;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <MobileSelectCard isSelected={isSelected} onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-semibold">{item.key}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{item.mime}</p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(item.size)}</span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{formatDateTime(item.createdAt)}</span>
        <span>引用 {item.refcount}</span>
      </div>
    </MobileSelectCard>
  );
}
