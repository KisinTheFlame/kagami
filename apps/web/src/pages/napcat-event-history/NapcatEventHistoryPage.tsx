import { type NapcatEventItem } from "@kagami/shared/schemas/napcat-event";
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
import {
  isoToLocalDateTime,
  localDateTimeToIso,
  normalizeOptionalText,
  setIfNonEmpty,
} from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { NapcatEventDetailPanel } from "./NapcatEventDetailPanel";
import { useNapcatEventList } from "./useNapcatEventList";

const PAGE_SIZE = 20;

type FilterFormState = {
  postType: string;
  messageType: string;
  userId: string;
  startAtLocal: string;
  endAtLocal: string;
};

export function NapcatEventHistoryPage() {
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
  const { data, isLoading, isError, refetch } = useNapcatEventList(page, PAGE_SIZE, filters);
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
            <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">
                Post Type
              </span>
              <input
                value={formState.postType}
                onChange={event =>
                  setFormState(prev => ({ ...prev, postType: event.target.value }))
                }
                placeholder="如 message/notice"
                className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">
                Message Type
              </span>
              <input
                value={formState.messageType}
                onChange={event =>
                  setFormState(prev => ({ ...prev, messageType: event.target.value }))
                }
                placeholder="如 private/group"
                className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">
                User ID
              </span>
              <input
                value={formState.userId}
                onChange={event => setFormState(prev => ({ ...prev, userId: event.target.value }))}
                placeholder="精确匹配"
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
                <TableHead className="w-[160px]">入库时间</TableHead>
                <TableHead className="w-[120px]">Post Type</TableHead>
                <TableHead className="w-[120px]">Message Type</TableHead>
                <TableHead className="w-[180px]">User ID</TableHead>
                <TableHead className="w-[180px]">Group ID</TableHead>
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
                      {formatDate(item.createdAt)}
                    </TableCell>
                    <TableCell className="truncate text-sm">{item.postType}</TableCell>
                    <TableCell className="truncate text-sm text-muted-foreground">
                      {item.messageType ?? "—"}
                    </TableCell>
                    <TableCell className="truncate font-mono text-xs text-muted-foreground">
                      {item.userId ?? "—"}
                    </TableCell>
                    <TableCell className="truncate font-mono text-xs text-muted-foreground">
                      {item.groupId ?? "—"}
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
                <NapcatEventMobileCard
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
      detailPanel={<NapcatEventDetailPanel item={selectedItem} />}
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

function parseFilters(params: URLSearchParams) {
  return {
    postType: normalizeOptionalText(params.get("postType")),
    messageType: normalizeOptionalText(params.get("messageType")),
    userId: normalizeOptionalText(params.get("userId")),
    startAt: normalizeOptionalText(params.get("startAt")),
    endAt: normalizeOptionalText(params.get("endAt")),
  };
}

function toFormState(params: URLSearchParams): FilterFormState {
  return {
    postType: params.get("postType") ?? "",
    messageType: params.get("messageType") ?? "",
    userId: params.get("userId") ?? "",
    startAtLocal: isoToLocalDateTime(params.get("startAt")),
    endAtLocal: isoToLocalDateTime(params.get("endAt")),
  };
}

function buildSearchParams(formState: FilterFormState): URLSearchParams {
  const nextParams = new URLSearchParams();

  setIfNonEmpty(nextParams, "postType", formState.postType);
  setIfNonEmpty(nextParams, "messageType", formState.messageType);
  setIfNonEmpty(nextParams, "userId", formState.userId);

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
    postType: "",
    messageType: "",
    userId: "",
    startAtLocal: "",
    endAtLocal: "",
  };
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

function getDetailTitle(item: { postType: string; messageType: string | null } | null): string {
  if (item === null) {
    return "NapCat 事件详情";
  }

  return `${item.postType} · ${item.messageType ?? "未知消息类型"}`;
}

function NapcatEventMobileCard({
  item,
  isSelected,
  onClick,
}: {
  item: NapcatEventItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <MobileSelectCard isSelected={isSelected} onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{item.postType}</p>
          <p className="mt-1 text-xs text-muted-foreground">{item.messageType ?? "—"}</p>
        </div>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {item.userId ?? "—"}
        </span>
      </div>

      <p className="mt-3 font-mono text-xs text-muted-foreground">{item.groupId ?? "—"}</p>
      <p className="mt-3 text-xs text-muted-foreground">{formatDate(item.createdAt)}</p>
    </MobileSelectCard>
  );
}
