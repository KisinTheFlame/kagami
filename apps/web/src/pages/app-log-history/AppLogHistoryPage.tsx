import { type AppLogItem, type AppLogLevel } from "@kagami/shared/schemas/app-log";
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
import {
  isoToLocalDateTime,
  localDateTimeToIso,
  normalizeOptionalText,
  setIfNonEmpty,
} from "@/lib/search-params";
import { cn, truncateText } from "@/lib/utils";
import { AppLogDetailPanel } from "./AppLogDetailPanel";
import { useAppLogList } from "./useAppLogList";

const PAGE_SIZE = 20;
const APP_LOG_LEVELS: AppLogLevel[] = ["debug", "info", "warn", "error", "fatal"];
const ALL_LEVEL_VALUE = "__all__";

type FilterFormState = {
  level: "" | AppLogLevel;
  traceId: string;
  message: string;
  source: string;
  startAtLocal: string;
  endAtLocal: string;
};

export function AppLogHistoryPage() {
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
  const { data, isLoading, isFetching, isError, refetch } = useAppLogList(page, PAGE_SIZE, filters);
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
          className={cn("rounded-md border p-4", showMobileDetail && "hidden")}
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">级别</span>
              <Select
                value={formState.level || ALL_LEVEL_VALUE}
                onValueChange={value =>
                  setFormState(prev => ({
                    ...prev,
                    level: value === ALL_LEVEL_VALUE ? "" : (value as FilterFormState["level"]),
                  }))
                }
              >
                <SelectTrigger aria-label="级别" className="min-w-0 flex-1">
                  <SelectValue placeholder="全部" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_LEVEL_VALUE}>全部</SelectItem>
                  {APP_LOG_LEVELS.map(level => (
                    <SelectItem key={level} value={level}>
                      {level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">
                Trace ID
              </span>
              <input
                value={formState.traceId}
                onChange={event => setFormState(prev => ({ ...prev, traceId: event.target.value }))}
                placeholder="精确匹配"
                className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">
                Message 关键词
              </span>
              <input
                value={formState.message}
                onChange={event => setFormState(prev => ({ ...prev, message: event.target.value }))}
                placeholder="包含匹配"
                className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">
                Source 关键词
              </span>
              <input
                value={formState.source}
                onChange={event => setFormState(prev => ({ ...prev, source: event.target.value }))}
                placeholder="metadata.source 包含匹配"
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
            <Button type="button" size="sm" variant="outline" onClick={resetFilters}>
              重置
            </Button>
          </div>
        </form>
      }
      desktopList={
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
          <Table className="min-w-[760px] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">时间</TableHead>
                <TableHead className="w-[80px]">级别</TableHead>
                <TableHead className="w-[220px]">Trace ID</TableHead>
                <TableHead className="w-[160px]">Source</TableHead>
                <TableHead>Message</TableHead>
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
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(item.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={toBadgeVariant(item.level)}>{item.level}</Badge>
                    </TableCell>
                    <TableCell className="truncate font-mono text-xs text-muted-foreground">
                      {item.traceId}
                    </TableCell>
                    <TableCell className="truncate text-xs text-muted-foreground">
                      {getSource(item.metadata)}
                    </TableCell>
                    <TableCell className="truncate text-sm">{item.message}</TableCell>
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
                <AppLogMobileCard
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
      detailPanel={<AppLogDetailPanel item={selectedItem} />}
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

function parseFilters(params: URLSearchParams) {
  return {
    level: parseLevel(params.get("level")),
    traceId: normalizeOptionalText(params.get("traceId")),
    message: normalizeOptionalText(params.get("message")),
    source: normalizeOptionalText(params.get("source")),
    startAt: normalizeOptionalText(params.get("startAt")),
    endAt: normalizeOptionalText(params.get("endAt")),
  };
}

function toFormState(params: URLSearchParams): FilterFormState {
  return {
    level: parseLevel(params.get("level")) ?? "",
    traceId: params.get("traceId") ?? "",
    message: params.get("message") ?? "",
    source: params.get("source") ?? "",
    startAtLocal: isoToLocalDateTime(params.get("startAt")),
    endAtLocal: isoToLocalDateTime(params.get("endAt")),
  };
}

function buildSearchParams(formState: FilterFormState): URLSearchParams {
  const nextParams = new URLSearchParams();

  if (formState.level) {
    nextParams.set("level", formState.level);
  }

  setIfNonEmpty(nextParams, "traceId", formState.traceId);
  setIfNonEmpty(nextParams, "message", formState.message);
  setIfNonEmpty(nextParams, "source", formState.source);

  const startAt = localDateTimeToIso(formState.startAtLocal);
  const endAt = localDateTimeToIso(formState.endAtLocal);
  if (startAt) {
    nextParams.set("startAt", startAt);
  }
  if (endAt) {
    nextParams.set("endAt", endAt);
  }

  return nextParams;
}

function createEmptyFormState(): FilterFormState {
  return {
    level: "",
    traceId: "",
    message: "",
    source: "",
    startAtLocal: "",
    endAtLocal: "",
  };
}

function parseLevel(value: string | null): AppLogLevel | undefined {
  if (!value) {
    return undefined;
  }

  return APP_LOG_LEVELS.includes(value as AppLogLevel) ? (value as AppLogLevel) : undefined;
}

function toBadgeVariant(level: AppLogLevel): "default" | "secondary" | "destructive" | "outline" {
  if (level === "error" || level === "fatal") {
    return "destructive";
  }

  if (level === "warn") {
    return "secondary";
  }

  if (level === "debug") {
    return "outline";
  }

  return "default";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getSource(metadata: Record<string, unknown>): string {
  const source = metadata.source;
  return typeof source === "string" && source.length > 0 ? source : "—";
}

function getDetailTitle(item: { level: AppLogLevel; traceId: string } | null): string {
  if (item === null) {
    return "应用日志详情";
  }

  return `${item.level.toUpperCase()} · ${item.traceId}`;
}

function AppLogMobileCard({
  item,
  isSelected,
  onClick,
}: {
  item: AppLogItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <MobileSelectCard isSelected={isSelected} onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-muted-foreground">{item.traceId}</p>
          <p className="mt-2 text-sm font-medium">{truncateText(item.message, 140)}</p>
        </div>
        <Badge variant={toBadgeVariant(item.level)}>{item.level}</Badge>
      </div>

      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
        <p>{formatDate(item.createdAt)}</p>
        <p>Source: {getSource(item.metadata)}</p>
      </div>
    </MobileSelectCard>
  );
}
