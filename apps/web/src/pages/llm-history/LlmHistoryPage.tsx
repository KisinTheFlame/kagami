import { type LlmChatCallItem, type LlmChatCallStatus } from "@kagami/shared";
import { type FormEvent, useMemo } from "react";
import { HistoryListPageLayout } from "@/components/layout/HistoryListPageLayout";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { LlmChatCallDetailPanel } from "./LlmChatCallDetailPanel";
import { parseLlmChatCallDetail } from "./llm-chat-call-detail-parser";
import { useLlmChatCallList } from "./useLlmChatCallList";

const PAGE_SIZE = 20;

type FilterFormState = {
  status: "" | LlmChatCallStatus;
};

export function LlmHistoryPage() {
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
  const { data, isLoading, isError, refetch } = useLlmChatCallList(page, PAGE_SIZE, filters);
  const total = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = useMemo(
    () =>
      (data?.items ?? []).map(item => ({
        item,
        detailParse: parseLlmChatCallDetail(item),
      })),
    [data?.items],
  );
  const selectedItem = useMemo(
    () => rows.find(row => row.item.id === selectedId)?.item ?? null,
    [rows, selectedId],
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">状态</span>
              <select
                value={formState.status}
                onChange={event =>
                  setFormState(prev => ({
                    ...prev,
                    status: event.target.value as FilterFormState["status"],
                  }))
                }
                className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">全部</option>
                <option value="success">成功</option>
                <option value="failed">失败</option>
              </select>
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
          <Table className="min-w-[680px] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[190px]">时间</TableHead>
                <TableHead className="w-[130px]">Provider</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="w-[140px]">状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    加载中…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    暂无数据
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(({ item, detailParse }) => (
                  <TableRow
                    key={item.id}
                    data-state={selectedId === item.id ? "selected" : undefined}
                    className="cursor-pointer"
                    onClick={() => handleSelectItem(item.id)}
                  >
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(item.createdAt)}
                    </TableCell>
                    <TableCell className="truncate text-sm">{item.provider}</TableCell>
                    <TableCell className="truncate text-sm">{item.model}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant={item.status === "success" ? "default" : "destructive"}>
                        {toStatusLabel(item.status)}
                      </Badge>
                      {detailParse.hasSchemaError ? (
                        <Badge variant="outline" className="ml-2">
                          解析失败
                        </Badge>
                      ) : null}
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
          ) : rows.length === 0 ? (
            <div className="flex h-24 items-center justify-center rounded-md border text-sm text-muted-foreground">
              暂无数据
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map(({ item, detailParse }) => (
                <LlmHistoryMobileCard
                  key={item.id}
                  item={item}
                  hasSchemaError={detailParse.hasSchemaError}
                  isSelected={selectedId === item.id}
                  onClick={() => handleSelectItem(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      }
      detailPanel={<LlmChatCallDetailPanel item={selectedItem} />}
      detailTitle={getDetailTitle(selectedItem)}
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

function parseFilters(params: URLSearchParams): { status: LlmChatCallStatus | undefined } {
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
  return { status: "" };
}

function parseStatus(value: string | null): LlmChatCallStatus | undefined {
  if (value === "success" || value === "failed") {
    return value;
  }

  return undefined;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function toStatusLabel(status: LlmChatCallStatus): string {
  return status === "success" ? "成功" : "失败";
}

function getDetailTitle(item: LlmChatCallItem | null): string {
  if (item === null) {
    return "LLM 调用详情";
  }

  return `${item.provider} · ${item.model} · ${toStatusLabel(item.status)}`;
}

function LlmHistoryMobileCard({
  item,
  hasSchemaError,
  isSelected,
  onClick,
}: {
  item: LlmChatCallItem;
  hasSchemaError: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <MobileSelectCard isSelected={isSelected} onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{item.model}</p>
          <p className="mt-1 text-xs text-muted-foreground">{item.provider}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={item.status === "success" ? "default" : "destructive"}>
            {toStatusLabel(item.status)}
          </Badge>
          {hasSchemaError ? <Badge variant="outline">解析失败</Badge> : null}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{formatDate(item.createdAt)}</span>
      </div>
    </MobileSelectCard>
  );
}
