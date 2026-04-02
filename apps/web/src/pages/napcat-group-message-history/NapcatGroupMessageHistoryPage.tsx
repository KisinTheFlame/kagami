import {
  type NapcatQqMessageItem,
  type NapcatQqMessageType,
} from "@kagami/shared/schemas/napcat-group-message";
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
import { cn, truncateText } from "@/lib/utils";
import { renderNapcatMessagePreview } from "./message-render";
import { NapcatGroupMessageDetailPanel } from "./NapcatGroupMessageDetailPanel";
import { useNapcatGroupMessageList } from "./useNapcatGroupMessageList";

const PAGE_SIZE = 20;

type FilterFormState = {
  messageType: "" | NapcatQqMessageType;
  groupId: string;
  userId: string;
  nickname: string;
  keyword: string;
  startAtLocal: string;
  endAtLocal: string;
};

export function NapcatGroupMessageHistoryPage() {
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
  const { data, isLoading, isFetching, isError, refetch } = useNapcatGroupMessageList(
    page,
    PAGE_SIZE,
    filters,
  );
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
            <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">
                消息类型
              </span>
              <select
                value={formState.messageType}
                onChange={event =>
                  setFormState(prev => ({
                    ...prev,
                    messageType: event.target.value as FilterFormState["messageType"],
                  }))
                }
                className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">全部</option>
                <option value="group">群聊</option>
                <option value="private">单聊</option>
              </select>
            </label>

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
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">昵称</span>
              <input
                value={formState.nickname}
                onChange={event =>
                  setFormState(prev => ({ ...prev, nickname: event.target.value }))
                }
                placeholder="包含匹配"
                className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">
                关键词
              </span>
              <input
                value={formState.keyword}
                onChange={event => setFormState(prev => ({ ...prev, keyword: event.target.value }))}
                placeholder="匹配 message JSON 文本"
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
                <TableHead className="w-[160px]">事件时间</TableHead>
                <TableHead className="w-[96px]">类型</TableHead>
                <TableHead className="w-[140px]">会话</TableHead>
                <TableHead className="w-[140px]">User ID</TableHead>
                <TableHead className="w-[140px]">昵称</TableHead>
                <TableHead>消息内容</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isInitialLoading ? (
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
                      {formatDate(item.eventTime)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatMessageType(item.messageType)}
                    </TableCell>
                    <TableCell className="truncate font-mono text-xs text-muted-foreground">
                      {formatConversationTarget(item)}
                    </TableCell>
                    <TableCell className="truncate font-mono text-xs text-muted-foreground">
                      {item.userId ?? "—"}
                    </TableCell>
                    <TableCell className="truncate text-sm text-muted-foreground">
                      {item.nickname ?? "—"}
                    </TableCell>
                    <TableCell className="truncate text-sm">
                      {renderNapcatMessagePreview(item.message)}
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
      }
      detailPanel={<NapcatGroupMessageDetailPanel item={selectedItem} />}
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
    messageType: normalizeMessageType(params.get("messageType")),
    groupId: normalizeOptionalText(params.get("groupId")),
    userId: normalizeOptionalText(params.get("userId")),
    nickname: normalizeOptionalText(params.get("nickname")),
    keyword: normalizeOptionalText(params.get("keyword")),
    startAt: normalizeOptionalText(params.get("startAt")),
    endAt: normalizeOptionalText(params.get("endAt")),
  };
}

function toFormState(params: URLSearchParams): FilterFormState {
  return {
    messageType: normalizeMessageType(params.get("messageType")) ?? "",
    groupId: params.get("groupId") ?? "",
    userId: params.get("userId") ?? "",
    nickname: params.get("nickname") ?? "",
    keyword: params.get("keyword") ?? "",
    startAtLocal: isoToLocalDateTime(params.get("startAt")),
    endAtLocal: isoToLocalDateTime(params.get("endAt")),
  };
}

function buildSearchParams(formState: FilterFormState): URLSearchParams {
  const nextParams = new URLSearchParams();

  setIfNonEmpty(nextParams, "messageType", formState.messageType);
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

  return nextParams;
}

function createEmptyFormState(): FilterFormState {
  return {
    messageType: "",
    groupId: "",
    userId: "",
    nickname: "",
    keyword: "",
    startAtLocal: "",
    endAtLocal: "",
  };
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

function getDetailTitle(
  item: {
    messageType: NapcatQqMessageType;
    groupId: string | null;
    nickname: string | null;
    userId: string | null;
  } | null,
): string {
  if (item === null) {
    return "QQ 消息详情";
  }

  return `${formatMessageType(item.messageType)} · ${formatConversationTarget(item)} · ${item.nickname ?? item.userId ?? "QQ 消息"}`;
}

function NapcatGroupMessageMobileCard({
  item,
  isSelected,
  onClick,
}: {
  item: NapcatQqMessageItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <MobileSelectCard isSelected={isSelected} onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">
            {formatMessageType(item.messageType)} · {formatConversationTarget(item)}
          </p>
          <p className="mt-2 text-sm font-medium">{item.nickname ?? item.userId ?? "匿名成员"}</p>
        </div>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {item.userId ?? "—"}
        </span>
      </div>

      <p className="mt-3 text-sm text-foreground">
        {truncateText(renderNapcatMessagePreview(item.message), 140)}
      </p>
      <p className="mt-3 text-xs text-muted-foreground">{formatDate(item.eventTime)}</p>
    </MobileSelectCard>
  );
}

function normalizeMessageType(value: string | null): NapcatQqMessageType | undefined {
  return value === "group" || value === "private" ? value : undefined;
}

function formatMessageType(messageType: NapcatQqMessageType): string {
  return messageType === "group" ? "群聊" : "单聊";
}

function formatConversationTarget(item: {
  messageType: NapcatQqMessageType;
  groupId: string | null;
  userId: string | null;
}): string {
  if (item.messageType === "group") {
    return item.groupId ?? "—";
  }

  return item.userId ?? "—";
}
