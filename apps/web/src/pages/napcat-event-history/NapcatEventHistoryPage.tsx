import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NapcatEventDetailPanel } from "./NapcatEventDetailPanel";
import { useNapcatEventList } from "./useNapcatEventList";

const PAGE_SIZE = 20;

type FilterFormState = {
  postType: string;
  messageType: string;
  userId: string;
  keyword: string;
  startAtLocal: string;
  endAtLocal: string;
};

export function NapcatEventHistoryPage() {
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const page = parsePage(params.get("page"));

  const filters = useMemo(
    () => ({
      postType: normalizeText(params.get("postType")),
      messageType: normalizeText(params.get("messageType")),
      userId: normalizeText(params.get("userId")),
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

  const { data, isLoading, isError } = useNapcatEventList(page, PAGE_SIZE, filters);
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

    setIfNonEmpty(nextParams, "postType", formState.postType);
    setIfNonEmpty(nextParams, "messageType", formState.messageType);
    setIfNonEmpty(nextParams, "userId", formState.userId);
    setIfNonEmpty(nextParams, "keyword", formState.keyword);

    const startAt = localDateTimeToIso(formState.startAtLocal);
    const endAt = localDateTimeToIso(formState.endAtLocal);

    if (startAt) {
      nextParams.set("startAt", startAt);
    }
    if (endAt) {
      nextParams.set("endAt", endAt);
    }

    setSelectedId(null);
    setParams(nextParams);
  }

  function handleResetFilters() {
    setFormState({
      postType: "",
      messageType: "",
      userId: "",
      keyword: "",
      startAtLocal: "",
      endAtLocal: "",
    });
    setSelectedId(null);
    setParams({ page: "1" });
  }

  function goToPage(next: number) {
    const nextParams = new URLSearchParams(params);
    nextParams.set("page", String(next));
    setParams(nextParams);
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden p-6">
      <form onSubmit={handleFilterSubmit} className="rounded-md border p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <label className="flex items-center gap-3 text-sm">
            <span className="w-24 shrink-0 text-right text-muted-foreground">Post Type</span>
            <input
              value={formState.postType}
              onChange={event => setFormState(prev => ({ ...prev, postType: event.target.value }))}
              placeholder="如 message/notice"
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </label>

          <label className="flex items-center gap-3 text-sm">
            <span className="w-24 shrink-0 text-right text-muted-foreground">Message Type</span>
            <input
              value={formState.messageType}
              onChange={event =>
                setFormState(prev => ({ ...prev, messageType: event.target.value }))
              }
              placeholder="如 private/group"
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </label>

          <label className="flex items-center gap-3 text-sm">
            <span className="w-24 shrink-0 text-right text-muted-foreground">User ID</span>
            <input
              value={formState.userId}
              onChange={event => setFormState(prev => ({ ...prev, userId: event.target.value }))}
              placeholder="精确匹配"
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </label>

          <label className="flex items-center gap-3 text-sm">
            <span className="w-24 shrink-0 text-right text-muted-foreground">关键词</span>
            <input
              value={formState.keyword}
              onChange={event => setFormState(prev => ({ ...prev, keyword: event.target.value }))}
              placeholder="匹配 raw_message"
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </label>

          <label className="flex items-center gap-3 text-sm">
            <span className="w-24 shrink-0 text-right text-muted-foreground">开始时间</span>
            <input
              type="datetime-local"
              value={formState.startAtLocal}
              onChange={event =>
                setFormState(prev => ({ ...prev, startAtLocal: event.target.value }))
              }
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </label>

          <label className="flex items-center gap-3 text-sm">
            <span className="w-24 shrink-0 text-right text-muted-foreground">结束时间</span>
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

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          {isError ? (
            <p className="text-sm text-destructive">加载失败，请检查后端服务是否运行。</p>
          ) : null}

          <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
            <Table className="min-w-[980px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[190px]">入库时间</TableHead>
                  <TableHead className="w-[150px]">Post Type</TableHead>
                  <TableHead className="w-[150px]">Message Type</TableHead>
                  <TableHead className="w-[220px]">User ID</TableHead>
                  <TableHead>Raw Message</TableHead>
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
                      onClick={() => setSelectedId(item.id)}
                    >
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(item.createdAt)}
                      </TableCell>
                      <TableCell className="truncate text-sm">{item.postType}</TableCell>
                      <TableCell className="truncate text-sm text-muted-foreground">
                        {item.messageType ?? "—"}
                      </TableCell>
                      <TableCell className="truncate font-mono text-xs text-muted-foreground">
                        {item.userId ?? "—"}
                      </TableCell>
                      <TableCell className="truncate text-sm">{item.rawMessage ?? "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-end gap-2">
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
          </div>
          <p className="text-right text-xs text-muted-foreground">
            共 {total} 条，{totalPages} 页
          </p>
        </section>

        <aside className="h-[40%] min-h-[160px] w-full min-w-0 rounded-md border bg-background xl:h-full xl:min-h-0 xl:w-auto xl:flex-1">
          <NapcatEventDetailPanel item={selectedItem} />
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
    postType: params.get("postType") ?? "",
    messageType: params.get("messageType") ?? "",
    userId: params.get("userId") ?? "",
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
