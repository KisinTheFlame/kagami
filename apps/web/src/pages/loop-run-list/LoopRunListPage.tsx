import type { LoopRunListItem, LoopRunStatus } from "@kagami/shared";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { HistoryListPageLayout } from "@/components/layout/HistoryListPageLayout";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  areSearchParamsEqual,
  normalizeOptionalText,
  parsePositivePage,
  setIfNonEmpty,
} from "@/lib/search-params";
import { cn, truncateText } from "@/lib/utils";
import { useLoopRunList } from "./useLoopRunList";

const PAGE_SIZE = 20;
const ALL_STATUS_VALUE = "__all__";

type FilterFormState = {
  status: "" | LoopRunStatus;
  groupId: string;
};

export function LoopRunListPage() {
  const [params, setParams] = useSearchParams();
  const isMobile = useIsMobile();
  const page = useMemo(() => parsePositivePage(params.get("page")), [params]);
  const filters = useMemo(() => normalizeFilters(parseFilters(params)), [params]);
  const [formState, setFormState] = useState<FilterFormState>(() => toFormState(params));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isMobileDetailOpen, setIsMobileDetailOpen] = useState(false);
  const { data, isLoading, isError, refetch } = useLoopRunList(page, PAGE_SIZE, filters);
  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const total = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showMobileDetail = isMobile && isMobileDetailOpen && selectedId !== null;
  const selectedItem = useMemo(
    () => items.find(item => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  useEffect(() => {
    setFormState(toFormState(params));
  }, [params]);

  function handleSelectItem(id: string) {
    setSelectedId(id);
    if (isMobile) {
      setIsMobileDetailOpen(true);
    }
  }

  function handleBackToList() {
    setIsMobileDetailOpen(false);
  }

  function resetDetailState() {
    setSelectedId(null);
    setIsMobileDetailOpen(false);
  }

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextParams = buildSearchParams(formState);
    nextParams.set("page", "1");
    resetDetailState();
    if (areSearchParamsEqual(params, nextParams)) {
      void refetch();
      return;
    }
    setParams(nextParams);
  }

  function resetFilters() {
    const nextFormState = createEmptyFormState();
    const nextParams = buildSearchParams(nextFormState);
    nextParams.set("page", "1");
    setFormState(nextFormState);
    resetDetailState();
    if (areSearchParamsEqual(params, nextParams)) {
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
    <HistoryListPageLayout
      filterForm={
        <form
          onSubmit={handleFilterSubmit}
          className={cn("rounded-md border p-4", showMobileDetail && "hidden")}
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
                  <SelectItem value="success">成功</SelectItem>
                  <SelectItem value="failed">失败</SelectItem>
                  <SelectItem value="partial">进行中</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">群号</span>
              <input
                value={formState.groupId}
                onChange={event => setFormState(prev => ({ ...prev, groupId: event.target.value }))}
                placeholder="精确匹配"
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
          <Table className="min-w-[840px] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[170px]">开始时间</TableHead>
                <TableHead className="w-[110px]">状态</TableHead>
                <TableHead className="w-[130px]">群号</TableHead>
                <TableHead className="w-[120px]">耗时</TableHead>
                <TableHead className="w-[120px]">步骤摘要</TableHead>
                <TableHead>触发消息</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    加载中…
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
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
                      {formatDateTime(item.startedAt)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="truncate font-mono text-xs text-muted-foreground">
                      {item.groupId}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.durationMs === null ? "进行中" : formatDuration(item.durationMs)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      LLM {item.summary.llmCallCount} / Tool {item.summary.toolCallCount}
                    </TableCell>
                    <TableCell className="truncate text-sm">
                      {truncateText(item.trigger.rawMessage || "空消息", 120)}
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
                <MobileSelectCard
                  key={item.id}
                  isSelected={selectedId === item.id}
                  onClick={() => handleSelectItem(item.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={item.status} />
                        <span className="font-mono text-xs text-muted-foreground">
                          {item.groupId}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium">
                        {truncateText(item.trigger.rawMessage || "空消息", 80)}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(item.startedAt)}
                    </span>
                  </div>
                </MobileSelectCard>
              ))}
            </div>
          )}
        </div>
      }
      detailPanel={<LoopRunListDetailPanel item={selectedItem} />}
      detailTitle="Loop 详情入口"
      isMobile={isMobile}
      showMobileDetail={showMobileDetail}
      isError={isError}
      errorMessage="加载 Loop 列表失败，请检查后端服务是否运行。"
      page={page}
      total={total}
      totalPages={totalPages}
      onPrevPage={() => goToPage(Math.max(1, page - 1))}
      onNextPage={() => goToPage(Math.min(totalPages, page + 1))}
      onBackToList={handleBackToList}
    />
  );
}

function normalizeFilters(filters: ReturnType<typeof parseFilters>) {
  return {
    status: filters.status || undefined,
    groupId: filters.groupId,
  };
}

function LoopRunListDetailPanel({ item }: { item: LoopRunListItem | null }) {
  if (item === null) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="text-sm text-muted-foreground">请选择一条 Loop 记录</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-5 py-4">
        <div className="grid grid-cols-1 gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <MetaItem label="Loop ID" value={item.id} mono />
          <MetaItem label="状态" value={statusLabel(item.status)} />
          <MetaItem label="群号" value={item.groupId} mono />
          <MetaItem label="开始时间" value={formatDateTime(item.startedAt)} />
          <MetaItem
            label="耗时"
            value={item.durationMs === null ? "进行中" : formatDuration(item.durationMs)}
          />
          <MetaItem label="触发人" value={item.trigger.nickname} />
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <section className="space-y-2">
          <h3 className="text-base font-semibold">触发消息</h3>
          <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted/20 p-3 text-xs leading-6">
            {item.trigger.rawMessage}
          </pre>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-semibold">步骤摘要</h3>
          <div className="rounded-md border bg-muted/20 p-3 text-xs leading-6 text-muted-foreground">
            LLM 调用 {item.summary.llmCallCount} 次，工具调用 {item.summary.toolCallCount} 次，
            工具成功 {item.summary.toolSuccessCount} 次，工具失败 {item.summary.toolFailureCount}{" "}
            次。
          </div>
        </section>

        <Link
          to={`/loop-runs/${item.id}`}
          className={cn(buttonVariants({ variant: "default" }), "w-full")}
        >
          打开完整详情页
        </Link>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: LoopRunStatus }) {
  const tone =
    status === "success"
      ? { text: "成功", className: "bg-emerald-500/15 text-emerald-700" }
      : status === "failed"
        ? { text: "失败", className: "bg-rose-500/15 text-rose-700" }
        : { text: "进行中", className: "bg-amber-500/15 text-amber-700" };

  return <Badge className={cn("border-transparent", tone.className)}>{tone.text}</Badge>;
}

function MetaItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={mono ? "break-all font-mono text-xs text-foreground" : "text-xs text-foreground"}
      >
        {value}
      </p>
    </div>
  );
}

function parseFilters(params: URLSearchParams) {
  return {
    status: parseStatus(params.get("status")),
    groupId: normalizeOptionalText(params.get("groupId")),
  };
}

function toFormState(params: URLSearchParams): FilterFormState {
  return {
    status: parseStatus(params.get("status")),
    groupId: params.get("groupId") ?? "",
  };
}

function buildSearchParams(formState: FilterFormState): URLSearchParams {
  const params = new URLSearchParams();
  setIfNonEmpty(params, "status", formState.status);
  setIfNonEmpty(params, "groupId", formState.groupId);
  return params;
}

function createEmptyFormState(): FilterFormState {
  return {
    status: "",
    groupId: "",
  };
}

function parseStatus(value: string | null): FilterFormState["status"] {
  return value === "success" || value === "failed" || value === "partial" ? value : "";
}

function statusLabel(status: LoopRunStatus): string {
  return status === "success" ? "成功" : status === "failed" ? "失败" : "进行中";
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 1 : 2)} s`;
}
