import { type NapcatGroupMessageItem } from "@kagami/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { MobileDetailHeader } from "@/components/layout/MobileDetailHeader";
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
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn, truncateText } from "@/lib/utils";
import { NapcatGroupMessageDetailPanel } from "./NapcatGroupMessageDetailPanel";
import { useNapcatGroupMessageList } from "./useNapcatGroupMessageList";

const PAGE_SIZE = 20;

type FilterFormState = {
  groupId: string;
  userId: string;
  nickname: string;
  keyword: string;
  startAtLocal: string;
  endAtLocal: string;
};

export function NapcatGroupMessageHistoryPage() {
  const [params, setParams] = useSearchParams();
  const isMobile = useIsMobile();
  const { selectedId, showMobileDetail, handleSelectItem, handleBackToList, resetDetailState } =
    useMobileDetailState({ isMobile });
  const page = parsePage(params.get("page"));

  const filters = useMemo(
    () => ({
      groupId: normalizeText(params.get("groupId")),
      userId: normalizeText(params.get("userId")),
      nickname: normalizeText(params.get("nickname")),
      keyword: normalizeText(params.get("keyword")),
      startAt: normalizeText(params.get("startAt")),
      endAt: normalizeText(params.get("endAt")),
    }),
    [params],
  );

  const [formState, setFormState] = useState<FilterFormState>(() => toFormState(params));

  useEffect(() => {
    setFormState(toFormState(params));
  }, [params]);

  const { data, isLoading, isError, refetch } = useNapcatGroupMessageList(page, PAGE_SIZE, filters);
  const total = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = data?.items ?? [];

  const selectedItem = useMemo(
    () => data?.items.find(item => item.id === selectedId) ?? null,
    [data?.items, selectedId],
  );

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextParams = new URLSearchParams();
    nextParams.set("page", "1");

    setIfNonEmpty(nextParams, "groupId", formState.groupId);
    setIfNonEmpty(nextParams, "userId", formState.userId);
    setIfNonEmpty(nextParams, "nickname", formState.nickname);
    setIfNonEmpty(nextParams, "keyword", formState.keyword);

    const startAt = localDateTimeToIso(formState.startAtLocal);
    const endAt = localDateTimeToIso(formState.endAtLocal);

    if (startAt) {
      nextParams.set("startAt", startAt);
    }
    if (endAt) {
      nextParams.set("endAt", endAt);
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

    setFormState({
      groupId: "",
      userId: "",
      nickname: "",
      keyword: "",
      startAtLocal: "",
      endAtLocal: "",
    });
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
            <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">
              Group ID
            </span>
            <input
              value={formState.groupId}
              onChange={event => setFormState(prev => ({ ...prev, groupId: event.target.value }))}
              placeholder="精确匹配"
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
            <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">User ID</span>
            <input
              value={formState.userId}
              onChange={event => setFormState(prev => ({ ...prev, userId: event.target.value }))}
              placeholder="精确匹配"
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
            <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">昵称</span>
            <input
              value={formState.nickname}
              onChange={event => setFormState(prev => ({ ...prev, nickname: event.target.value }))}
              placeholder="包含匹配"
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
            <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">关键词</span>
            <input
              value={formState.keyword}
              onChange={event => setFormState(prev => ({ ...prev, keyword: event.target.value }))}
              placeholder="匹配 raw_message"
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
            <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">
              开始时间
            </span>
            <input
              type="datetime-local"
              value={formState.startAtLocal}
              onChange={event =>
                setFormState(prev => ({ ...prev, startAtLocal: event.target.value }))
              }
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
            <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">
              结束时间
            </span>
            <input
              type="datetime-local"
              value={formState.endAtLocal}
              onChange={event =>
                setFormState(prev => ({ ...prev, endAtLocal: event.target.value }))
              }
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
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

      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 md:mt-4 md:gap-4 xl:flex-row">
        <section
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col gap-3 md:gap-4",
            showMobileDetail && "hidden",
          )}
        >
          {isError ? (
            <p className="text-sm text-destructive">加载失败，请检查后端服务是否运行。</p>
          ) : null}

          {isMobile ? (
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
                    <NapcatGroupMessageMobileCard
                      key={item.id}
                      item={item}
                      isSelected={selectedId === item.id}
                      onClick={() => handleSelectItem(item.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
              <Table className="min-w-[760px] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">事件时间</TableHead>
                    <TableHead className="w-[140px]">Group ID</TableHead>
                    <TableHead className="w-[140px]">User ID</TableHead>
                    <TableHead className="w-[140px]">昵称</TableHead>
                    <TableHead>消息内容</TableHead>
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
                          {formatDate(item.eventTime)}
                        </TableCell>
                        <TableCell className="truncate font-mono text-xs text-muted-foreground">
                          {item.groupId}
                        </TableCell>
                        <TableCell className="truncate font-mono text-xs text-muted-foreground">
                          {item.userId ?? "—"}
                        </TableCell>
                        <TableCell className="truncate text-sm text-muted-foreground">
                          {item.nickname ?? "—"}
                        </TableCell>
                        <TableCell className="truncate text-sm">{item.rawMessage}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2 sm:flex-nowrap">
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
                : "h-[40%] min-h-[160px] w-full xl:h-full xl:min-h-0 xl:w-auto xl:flex-1",
          )}
        >
          {showMobileDetail ? (
            <MobileDetailHeader title={getDetailTitle(selectedItem)} onBack={handleBackToList} />
          ) : null}
          <div className={cn(showMobileDetail && "min-h-0 flex-1 overflow-hidden")}>
            <NapcatGroupMessageDetailPanel item={selectedItem} />
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

function normalizeText(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toFormState(params: URLSearchParams): FilterFormState {
  return {
    groupId: params.get("groupId") ?? "",
    userId: params.get("userId") ?? "",
    nickname: params.get("nickname") ?? "",
    keyword: params.get("keyword") ?? "",
    startAtLocal: isoToLocalDateTime(params.get("startAt")),
    endAtLocal: isoToLocalDateTime(params.get("endAt")),
  };
}

function isoToLocalDateTime(value: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function localDateTimeToIso(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

function setIfNonEmpty(params: URLSearchParams, key: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return;
  }

  params.set(key, trimmed);
}

function formatDate(iso: string | null): string {
  if (!iso) {
    return "—";
  }

  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function hasSameSearchParams(left: URLSearchParams, right: URLSearchParams): boolean {
  return toComparableSearchParams(left) === toComparableSearchParams(right);
}

function toComparableSearchParams(params: URLSearchParams): string {
  const clone = new URLSearchParams(params);
  clone.sort();
  return clone.toString();
}

function getDetailTitle(
  item: { groupId: string; nickname: string | null; userId: string | null } | null,
): string {
  if (item === null) {
    return "群聊消息详情";
  }

  return `${item.groupId} · ${item.nickname ?? item.userId ?? "群聊消息"}`;
}

function NapcatGroupMessageMobileCard({
  item,
  isSelected,
  onClick,
}: {
  item: NapcatGroupMessageItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <MobileSelectCard isSelected={isSelected} onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">{item.groupId}</p>
          <p className="mt-2 text-sm font-medium">{item.nickname ?? item.userId ?? "匿名成员"}</p>
        </div>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {item.userId ?? "—"}
        </span>
      </div>

      <p className="mt-3 text-sm text-foreground">{truncateText(item.rawMessage, 140)}</p>
      <p className="mt-3 text-xs text-muted-foreground">{formatDate(item.eventTime)}</p>
    </MobileSelectCard>
  );
}
