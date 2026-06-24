import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getApiErrorMessage } from "@/lib/api";
import { useCompactMainAgentContext } from "./useCompactMainAgentContext";

export function ControlPanelPage() {
  const compactMutation = useCompactMainAgentContext();

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden p-3 md:p-6">
      <h1 className="text-2xl font-semibold tracking-tight">控制面板</h1>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>压缩主 Agent 上下文</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                将主 Agent 当前的<strong className="text-foreground">全部</strong>
                上下文一次性摘要成单条 summary，与常规压缩只摘要前 90% 不同，这里不保留最近消息。
                如果当前有 LLM 调用正在进行，会等本轮收尾后再压缩。
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={compactMutation.isPending}
                  onClick={() => compactMutation.mutate()}
                >
                  {compactMutation.isPending ? "压缩中…" : "立即压缩全部上下文"}
                </Button>

                {compactMutation.isSuccess ? (
                  <Badge variant={compactMutation.data.compacted ? "default" : "outline"}>
                    {compactMutation.data.compacted
                      ? `已压缩 · ${formatDateTime(compactMutation.data.compactedAt)}`
                      : "无可压缩内容"}
                  </Badge>
                ) : null}

                {compactMutation.isError ? <Badge variant="destructive">压缩失败</Badge> : null}
              </div>

              {compactMutation.isError ? (
                <p className="whitespace-pre-wrap break-words text-xs text-destructive">
                  {getApiErrorMessage(compactMutation.error)}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("zh-CN", { hour12: false });
}
