import { type LlmChatCallItem, type LlmChatCallStatus } from "@kagami/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MobileDetailHeader } from "@/components/layout/MobileDetailHeader";
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
import { useMobileDetailState } from "@/hooks/useMobileDetailState";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import { LlmChatCallDetailPanel } from "./LlmChatCallDetailPanel";
import { parseLlmChatCallDetail } from "./llm-chat-call-detail-parser";
import { useLlmChatCallList } from "./useLlmChatCallList";

const PAGE_SIZE = 20;

type FilterFormState = {
  status: "" | LlmChatCallStatus;
};

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

export function LlmHistoryPage() {
  const [params, setParams] = useSearchParams();
  const isMobile = useIsMobile();
  const { selectedId, showMobileDetail, handleSelectItem, handleBackToList, resetDetailState } =
    useMobileDetailState({ isMobile });
  const page = parsePage(params.get("page"));
  const filters = useMemo(
    () => ({
      status: parseStatus(params.get("status")),
    }),
    [params],
  );
  const [formState, setFormState] = useState<FilterFormState>(() => toFormState(params));

  useEffect(() => {
    setFormState(toFormState(params));
  }, [params]);

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

    const nextParams = new URLSearchParams();
    nextParams.set("page", "1");
    if (formState.status) {
      nextParams.set("status", formState.status);
    }

    resetDetailState();
    if (hasSameSearchParams(params, nextParams)) {
      void refetch();
      return;
    }

    setParams(nextParams);
  }

  function handleResetFilters() {
    const nextParams = new URLSearchParams();
    nextParams.set("page", "1");

    setFormState({ status: "" });
    resetDetailState();
    if (hasSameSearchParams(params, nextParams)) {
      void refetch();
      return;
    }

    setParams(nextParams);
  }

  function goToPage(next: number) {
    const nextParams = new URLSearchParams(params);
    nextParams.set("page", String(next));
    resetDetailState();
    setParams(nextParams);
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden p-3 md:p-6">
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
          <Button type="button" size="sm" variant="outline" onClick={handleResetFilters}>
            重置
          </Button>
        </div>
      </form>

      <div className={cn("mt-3 flex min-h-0 flex-1 flex-col gap-3 md:mt-4 md:gap-4 xl:flex-row")}>
        <section
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col gap-3 md:gap-4",
            showMobileDetail && "hidden",
          )}
        >
          {isError && (
            <p className="text-sm text-destructive">加载失败，请检查后端服务是否运行。</p>
          )}

          {isMobile ? (
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
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
              <Table className="min-w-[680px] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[190px]">时间</TableHead>
                    <TableHead className="w-[130px]">Provider</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="w-[140px]">状态</TableHead>
                    <TableHead className="w-[110px] text-right">延迟 (ms)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                        加载中…
                      </TableCell>
                    </TableRow>
                  ) : data?.items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
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
                        <TableCell className="text-right text-sm tabular-nums">
                          {item.latencyMs ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              上一页
            </Button>
            <span className="text-sm text-muted-foreground">第 {page} 页</span>
            <Button
              variant="outline"
              size="sm"
              disabled={!data || page >= totalPages}
              onClick={() => goToPage(page + 1)}
            >
              下一页
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              共 {total} 条，{totalPages} 页
            </span>
          </div>
        </section>

        <aside
          className={cn(
            "min-w-0 rounded-md border bg-background",
            showMobileDetail
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : isMobile
                ? "hidden"
                : "flex min-h-[160px] w-full flex-col overflow-hidden md:h-[40%] xl:h-full xl:min-h-0 xl:w-auto xl:flex-1",
          )}
        >
          {showMobileDetail ? (
            <MobileDetailHeader title={getDetailTitle(selectedItem)} onBack={handleBackToList} />
          ) : null}
          <div className="min-h-0 flex-1 overflow-hidden">
            <LlmChatCallDetailPanel item={selectedItem} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function parsePage(value: string | null): number {
  const parsed = Number(value ?? "1");
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
}

function parseStatus(value: string | null): LlmChatCallStatus | undefined {
  if (value === "success" || value === "failed") {
    return value;
  }

  return undefined;
}

function toFormState(params: URLSearchParams): FilterFormState {
  return {
    status: parseStatus(params.get("status")) ?? "",
  };
}

function hasSameSearchParams(left: URLSearchParams, right: URLSearchParams): boolean {
  return toComparableSearchParams(left) === toComparableSearchParams(right);
}

function toComparableSearchParams(params: URLSearchParams): string {
  const clone = new URLSearchParams(params);
  clone.sort();
  return clone.toString();
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
        <span className="tabular-nums">延迟 {item.latencyMs ?? "—"} ms</span>
      </div>
    </MobileSelectCard>
  );
}
