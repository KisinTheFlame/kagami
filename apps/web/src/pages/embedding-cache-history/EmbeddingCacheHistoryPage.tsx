import {
  type EmbeddingCacheItem,
  type EmbeddingTaskType,
} from "@kagami/shared/schemas/embedding-cache";
import { type FormEvent, useMemo } from "react";
import { HistoryListPageLayout } from "@/components/layout/HistoryListPageLayout";
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
import { EmbeddingCacheDetailPanel } from "./EmbeddingCacheDetailPanel";
import { useEmbeddingCacheList } from "./useEmbeddingCacheList";

const PAGE_SIZE = 20;
const TASK_TYPES: EmbeddingTaskType[] = ["RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY"];
const ALL_TASK_TYPE_VALUE = "__all__";

type FilterFormState = {
  provider: string;
  model: string;
  taskType: "" | EmbeddingTaskType;
  outputDimensionality: string;
  textHash: string;
  text: string;
  startAtLocal: string;
  endAtLocal: string;
};

export function EmbeddingCacheHistoryPage() {
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
  const { data, isLoading, isError, refetch } = useEmbeddingCacheList(page, PAGE_SIZE, filters);
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
                Provider
              </span>
              <input
                value={formState.provider}
                onChange={event =>
                  setFormState(prev => ({ ...prev, provider: event.target.value }))
                }
                placeholder="精确匹配"
                className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">Model</span>
              <input
                value={formState.model}
                onChange={event => setFormState(prev => ({ ...prev, model: event.target.value }))}
                placeholder="精确匹配"
                className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </label>

            <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">
                Task Type
              </span>
              <Select
                value={formState.taskType || ALL_TASK_TYPE_VALUE}
                onValueChange={value =>
                  setFormState(prev => ({
                    ...prev,
                    taskType:
                      value === ALL_TASK_TYPE_VALUE ? "" : (value as FilterFormState["taskType"]),
                  }))
                }
              >
                <SelectTrigger aria-label="Task Type" className="min-w-0 flex-1">
                  <SelectValue placeholder="全部" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TASK_TYPE_VALUE}>全部</SelectItem>
                  {TASK_TYPES.map(taskType => (
                    <SelectItem key={taskType} value={taskType}>
                      {taskType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">维度</span>
              <input
                value={formState.outputDimensionality}
                onChange={event =>
                  setFormState(prev => ({
                    ...prev,
                    outputDimensionality: event.target.value,
                  }))
                }
                placeholder="精确匹配"
                inputMode="numeric"
                className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">
                Text Hash
              </span>
              <input
                value={formState.textHash}
                onChange={event =>
                  setFormState(prev => ({ ...prev, textHash: event.target.value }))
                }
                placeholder="精确匹配"
                className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="text-muted-foreground sm:w-24 sm:shrink-0 sm:text-right">
                文本关键词
              </span>
              <input
                value={formState.text}
                onChange={event => setFormState(prev => ({ ...prev, text: event.target.value }))}
                placeholder="包含匹配"
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
          <Table className="min-w-[860px] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">时间</TableHead>
                <TableHead className="w-[90px]">Provider</TableHead>
                <TableHead className="w-[180px]">Model</TableHead>
                <TableHead className="w-[180px]">Task Type</TableHead>
                <TableHead className="w-[90px]">维度</TableHead>
                <TableHead>文本预览</TableHead>
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
                      {formatDate(item.createdAt)}
                    </TableCell>
                    <TableCell className="truncate text-sm">{item.provider}</TableCell>
                    <TableCell className="truncate text-xs text-muted-foreground">
                      {item.model}
                    </TableCell>
                    <TableCell className="truncate font-mono text-xs text-muted-foreground">
                      {item.taskType}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.embeddingDim}
                    </TableCell>
                    <TableCell className="truncate text-sm">
                      {truncateText(item.text, 120)}
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
                <EmbeddingCacheMobileCard
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
      detailPanel={<EmbeddingCacheDetailPanel item={selectedItem} />}
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

function EmbeddingCacheMobileCard({
  item,
  isSelected,
  onClick,
}: {
  item: EmbeddingCacheItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <MobileSelectCard isSelected={isSelected} onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {item.provider} / {item.model}
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{item.taskType}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{item.embeddingDim} 维</p>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{item.text}</p>
    </MobileSelectCard>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getDetailTitle(item: EmbeddingCacheItem | null): string {
  if (!item) {
    return "缓存详情";
  }

  return truncateText(item.model, 24);
}

function parseFilters(params: URLSearchParams) {
  return {
    provider: normalizeOptionalText(params.get("provider")),
    model: normalizeOptionalText(params.get("model")),
    taskType: normalizeTaskType(params.get("taskType")),
    outputDimensionality: normalizeOptionalPositiveInt(params.get("outputDimensionality")),
    textHash: normalizeOptionalText(params.get("textHash")),
    text: normalizeOptionalText(params.get("text")),
    startAt: localDateTimeToIso(isoToLocalDateTime(params.get("startAt"))),
    endAt: localDateTimeToIso(isoToLocalDateTime(params.get("endAt"))),
  };
}

function toFormState(params: URLSearchParams): FilterFormState {
  return {
    provider: params.get("provider") ?? "",
    model: params.get("model") ?? "",
    taskType: normalizeTaskType(params.get("taskType")) ?? "",
    outputDimensionality: params.get("outputDimensionality") ?? "",
    textHash: params.get("textHash") ?? "",
    text: params.get("text") ?? "",
    startAtLocal: isoToLocalDateTime(params.get("startAt")),
    endAtLocal: isoToLocalDateTime(params.get("endAt")),
  };
}

function buildSearchParams(formState: FilterFormState): URLSearchParams {
  const params = new URLSearchParams();
  setIfNonEmpty(params, "provider", formState.provider);
  setIfNonEmpty(params, "model", formState.model);
  if (formState.taskType) {
    params.set("taskType", formState.taskType);
  }
  setIfNonEmpty(params, "outputDimensionality", formState.outputDimensionality);
  setIfNonEmpty(params, "textHash", formState.textHash);
  setIfNonEmpty(params, "text", formState.text);

  const startAt = localDateTimeToIso(formState.startAtLocal);
  if (startAt) {
    params.set("startAt", startAt);
  }

  const endAt = localDateTimeToIso(formState.endAtLocal);
  if (endAt) {
    params.set("endAt", endAt);
  }

  return params;
}

function createEmptyFormState(): FilterFormState {
  return {
    provider: "",
    model: "",
    taskType: "",
    outputDimensionality: "",
    textHash: "",
    text: "",
    startAtLocal: "",
    endAtLocal: "",
  };
}

function normalizeTaskType(value: string | null): EmbeddingTaskType | undefined {
  if (value === "RETRIEVAL_DOCUMENT" || value === "RETRIEVAL_QUERY") {
    return value;
  }

  return undefined;
}

function normalizeOptionalPositiveInt(value: string | null): number | undefined {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return undefined;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}
