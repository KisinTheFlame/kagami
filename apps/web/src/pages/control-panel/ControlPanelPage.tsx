import { useState } from "react";
import {
  MAIN_AGENT_CONTEXT_COMPRESS_RATIO_MAX,
  MAIN_AGENT_CONTEXT_COMPRESS_RATIO_MIN,
} from "@kagami/agent-api/main-agent-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getApiErrorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  DEFAULT_COMPRESS_RATIO,
  describeCompressRatioError,
  parseCompressRatio,
} from "./compress-ratio";
import { useCompactMainAgentContext } from "./useCompactMainAgentContext";

export function ControlPanelPage() {
  const compactMutation = useCompactMainAgentContext();
  const [ratioInput, setRatioInput] = useState(String(DEFAULT_COMPRESS_RATIO));

  const parsedRatio = parseCompressRatio(ratioInput);
  const compactionResult = compactMutation.isSuccess ? compactMutation.data : null;
  // 并发压缩去重时会复用先到那次的比例，与本次输入不一定相同，如实标出来。
  const ratioDiverged =
    compactionResult !== null &&
    parsedRatio.ok &&
    compactionResult.appliedCompressRatio !== parsedRatio.value;

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
                把主 Agent 上下文里<strong className="text-foreground">最早的一段</strong>
                摘要成单条 summary：填 90 就是摘要前 90%、保留最近 10%，与阈值触发的自动压缩同一档；
                填 100 则全部摘要、一条不留。切点会向后扩到 tool-call
                边界，所以实际摘要条数可能略多于填的比例。 如果当前有 LLM
                调用正在进行，会等本轮收尾后再压缩。
              </p>

              <label className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-muted-foreground">压缩比例</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={MAIN_AGENT_CONTEXT_COMPRESS_RATIO_MIN}
                  max={MAIN_AGENT_CONTEXT_COMPRESS_RATIO_MAX}
                  value={ratioInput}
                  onChange={event => setRatioInput(event.target.value)}
                  className="w-24 rounded-none border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                <span className="text-muted-foreground">%</span>
              </label>

              {parsedRatio.ok ? null : (
                <p className="text-xs text-destructive">
                  {describeCompressRatioError(parsedRatio.reason)}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={compactMutation.isPending || !parsedRatio.ok}
                  onClick={() => {
                    if (!parsedRatio.ok) {
                      return;
                    }
                    compactMutation.mutate(parsedRatio.value);
                  }}
                >
                  {compactMutation.isPending ? "压缩中…" : "立即压缩上下文"}
                </Button>

                {compactionResult !== null ? (
                  <Badge variant={compactionResult.compacted ? "default" : "outline"}>
                    {compactionResult.compacted
                      ? `已压缩 · 摘要 ${String(compactionResult.summarizedCount)} 条 · 保留 ${String(compactionResult.keptCount)} 条 · ${formatDateTime(compactionResult.compactedAt)}`
                      : "无可压缩内容"}
                  </Badge>
                ) : null}

                {compactMutation.isError ? <Badge variant="destructive">压缩失败</Badge> : null}
              </div>

              {ratioDiverged && compactionResult !== null ? (
                <p className="text-xs text-muted-foreground">
                  实际按 {String(compactionResult.appliedCompressRatio)}%
                  执行（有并发压缩正在进行）。
                </p>
              ) : null}

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
