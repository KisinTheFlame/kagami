import { type InnerThoughtItem, type InnerThoughtOutcome } from "@kagami/console-api/inner-thought";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { formatDateTime } from "@/lib/format";
import { formatTriggerInterval } from "@/lib/inner-thought-format";
import { useInnerThoughtList } from "./useInnerThoughtList";

const PAGE_SIZE = 20;
const OUTCOMES: InnerThoughtOutcome[] = ["injected", "empty", "failed"];
const ALL_OUTCOME_VALUE = "__all__";

export function InnerThoughtPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parsePage(searchParams.get("page"));
  const outcome = parseOutcome(searchParams.get("outcome"));

  const { data, isLoading, isFetching, isError } = useInnerThoughtList(page, PAGE_SIZE, outcome);
  const isInitialLoading = isLoading && !data;
  const total = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = data?.items ?? [];

  function updateParams(next: { page?: number; outcome?: InnerThoughtOutcome | undefined }) {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if ("outcome" in next) {
        if (next.outcome) {
          params.set("outcome", next.outcome);
        } else {
          params.delete("outcome");
        }
        // 换筛选条件回到第一页，避免停留在越界页码。
        params.delete("page");
      }
      if (next.page !== undefined) {
        if (next.page <= 1) {
          params.delete("page");
        } else {
          params.set("page", String(next.page));
        }
      }
      return params;
    });
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden p-3 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">outcome</span>
          <Select
            value={outcome ?? ALL_OUTCOME_VALUE}
            onValueChange={value =>
              updateParams({
                outcome: value === ALL_OUTCOME_VALUE ? undefined : (value as InnerThoughtOutcome),
              })
            }
          >
            <SelectTrigger aria-label="outcome" className="w-[160px]">
              <SelectValue placeholder="全部" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_OUTCOME_VALUE}>全部</SelectItem>
              {OUTCOMES.map(value => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          共 {total} 次触发，{totalPages} 页
        </span>
      </div>

      {isError ? (
        <p className="mt-3 text-sm text-destructive">加载失败，请检查后端服务是否运行。</p>
      ) : null}

      <div className="mt-3 hidden min-h-0 flex-1 overflow-auto rounded-none border md:block">
        <Table className="min-w-[720px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[168px]">触发时刻</TableHead>
              <TableHead className="w-[96px]">间隔</TableHead>
              <TableHead className="w-[104px]">outcome</TableHead>
              <TableHead>念头</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isInitialLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  加载中…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  暂无数据
                </TableCell>
              </TableRow>
            ) : (
              items.map((item, index) => (
                <TableRow key={item.id} className="align-top">
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {formatDateTime(item.triggeredAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {intervalLabel(items, index, outcome !== undefined)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={toBadgeVariant(item.outcome)}>{item.outcome}</Badge>
                  </TableCell>
                  <TableCell className="text-sm leading-relaxed break-words whitespace-normal">
                    <ThoughtText item={item} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-auto md:hidden">
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
            {items.map((item, index) => (
              <div key={item.id} className="rounded-none border bg-card p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatDateTime(item.triggeredAt)}
                  </span>
                  <Badge variant={toBadgeVariant(item.outcome)}>{item.outcome}</Badge>
                </div>
                <p className="mt-2 text-sm leading-relaxed break-words">
                  <ThoughtText item={item} />
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  距上次触发 {intervalLabel(items, index, outcome !== undefined)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || isFetching}
          onClick={() => updateParams({ page: page - 1 })}
        >
          <ChevronLeft className="h-4 w-4" />
          上一页
        </Button>
        <span className="text-sm text-muted-foreground">第 {page} 页</span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages || isFetching}
          onClick={() => updateParams({ page: page + 1 })}
        >
          下一页
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ThoughtText({ item }: { item: InnerThoughtItem }) {
  if (item.thought.length > 0) {
    return <>{item.thought}</>;
  }

  const placeholder = item.outcome === "failed" ? "（生成时异常，详情见应用日志）" : "（无念头）";
  return <span className="text-muted-foreground italic">{placeholder}</span>;
}

/**
 * 「距上次触发间隔」：列表按 createdAt 倒序，故上一次触发是紧邻的下一行（index+1）。
 * 当前页最后一行的上一次落在下一页、本页取不到，显 `—`。
 * outcome 筛选生效时，相邻行是「上一个同 outcome」而非「上一次触发」，间隔无意义 → 一律 `—`，
 * 避免把它误读成触发节奏。纯格式化逻辑抽到 lib 单测覆盖。
 */
function intervalLabel(items: InnerThoughtItem[], index: number, isFiltered: boolean): string {
  if (isFiltered) {
    return "—";
  }

  const previous = items[index + 1];
  if (!previous) {
    return "—";
  }

  return formatTriggerInterval(
    new Date(items[index].triggeredAt).getTime() - new Date(previous.triggeredAt).getTime(),
  );
}

function toBadgeVariant(outcome: InnerThoughtOutcome): BadgeProps["variant"] {
  if (outcome === "injected") {
    return "llm"; // 蓝 · 进了上下文
  }

  if (outcome === "failed") {
    return "signal"; // 红 · 异常
  }

  return "outline"; // 中性 · 空念头
}

function parsePage(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function parseOutcome(value: string | null): InnerThoughtOutcome | undefined {
  return OUTCOMES.includes(value as InnerThoughtOutcome)
    ? (value as InnerThoughtOutcome)
    : undefined;
}
