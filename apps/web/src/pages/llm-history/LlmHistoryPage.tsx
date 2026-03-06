import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LlmChatCallDetailPanel } from "./LlmChatCallDetailPanel";
import { parseLlmChatCallDetail } from "./llm-chat-call-detail-parser";
import { useLlmChatCallList } from "./useLlmChatCallList";

const PAGE_SIZE = 20;

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
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const page = Math.max(1, Number(params.get("page") ?? "1"));

  const { data, isLoading, isError } = useLlmChatCallList(page, PAGE_SIZE);
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

  function goToPage(next: number) {
    setParams({ page: String(next) });
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden p-6">
      <div className="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          {isError && (
            <p className="text-sm text-destructive">加载失败，请检查后端服务是否运行。</p>
          )}

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
                      onClick={() => setSelectedId(item.id)}
                    >
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDate(item.createdAt)}
                      </TableCell>
                      <TableCell className="truncate text-sm">{item.provider}</TableCell>
                      <TableCell className="truncate text-sm">{item.model}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant={item.status === "success" ? "default" : "destructive"}>
                          {item.status}
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

        <aside className="h-[40%] min-h-[160px] w-full min-w-0 rounded-md border bg-background xl:h-full xl:min-h-0 xl:w-auto xl:flex-1">
          <LlmChatCallDetailPanel item={selectedItem} />
        </aside>
      </div>
    </div>
  );
}
