import type { LlmChatCallItem, LlmRequestMessage } from "@kagami/shared";
import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parseLlmChatCallDetail } from "./llm-chat-call-detail-parser";

type LlmChatCallDetailPanelProps = {
  item: LlmChatCallItem | null;
};

export function LlmChatCallDetailPanel({ item }: LlmChatCallDetailPanelProps) {
  const [inputOrder, setInputOrder] = useState<"asc" | "desc">("asc");
  const parsed = useMemo(() => (item ? parseLlmChatCallDetail(item) : null), [item]);
  const orderedInputMessages = useMemo(() => {
    if (!parsed?.request) {
      return [];
    }

    const entries = parsed.request.messages.map((message, index) => ({
      message,
      originalIndex: index,
    }));
    if (inputOrder === "asc") {
      return entries;
    }

    return [...entries].reverse();
  }, [inputOrder, parsed]);

  if (item === null || parsed === null) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">调用详情</h2>
          <p className="text-sm text-muted-foreground">
            从中间列表选择一条记录后，这里会显示输入与输出。
          </p>
        </div>
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="text-sm text-muted-foreground">暂无选中记录</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-5 py-4">
        <h2 className="text-base font-semibold">调用详情</h2>
        <p className="text-sm text-muted-foreground">查看模型输入、输出与元信息。</p>

        <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-muted-foreground">
          <MetaItem label="Request ID" value={item.requestId} mono />
          <MetaItem label="Provider" value={item.provider} />
          <MetaItem label="Model" value={item.model} />
          <MetaItem label="状态" value={item.status} />
          <MetaItem label="延迟" value={item.latencyMs === null ? "—" : `${item.latencyMs} ms`} />
          <MetaItem label="时间" value={formatDate(item.createdAt)} />
        </div>

        {parsed.hasSchemaError ? (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <p className="font-medium">结构化解析失败</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {parsed.schemaErrors.map(message => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
        <section className="space-y-3">
          <h3 className="text-base font-semibold">输出</h3>
          {item.status === "success" ? (
            parsed.response ? (
              <>
                <ContentCard
                  title="Assistant 输出"
                  preview={buildPreview(parsed.response.message.content)}
                >
                  <pre className="whitespace-pre-wrap break-words text-xs leading-6">
                    {parsed.response.message.content}
                  </pre>
                  {parsed.response.message.toolCalls.length > 0 ? (
                    <ToolCallsList toolCalls={parsed.response.message.toolCalls} className="mt-3" />
                  ) : null}
                </ContentCard>

                {parsed.response.usage ? (
                  <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                    promptTokens: {parsed.response.usage.promptTokens ?? "—"} | completionTokens:{" "}
                    {parsed.response.usage.completionTokens ?? "—"} | totalTokens:{" "}
                    {parsed.response.usage.totalTokens ?? "—"}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                输出结构解析失败，请查看下方原始 JSON。
              </p>
            )
          ) : parsed.error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
              <p className="font-medium text-destructive">{parsed.error.name}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-6 text-destructive">
                {parsed.error.message}
              </p>
              {parsed.error.code ? (
                <p className="mt-2 font-mono text-xs text-destructive">code: {parsed.error.code}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">错误结构解析失败，请查看下方原始 JSON。</p>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold">输入</h3>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={inputOrder === "asc" ? "default" : "outline"}
                onClick={() => setInputOrder("asc")}
              >
                正序
              </Button>
              <Button
                size="sm"
                variant={inputOrder === "desc" ? "default" : "outline"}
                onClick={() => setInputOrder("desc")}
              >
                倒序
              </Button>
            </div>
          </div>
          {parsed.request ? (
            <>
              {parsed.request.system ? (
                <ContentCard title="System Prompt" preview={buildPreview(parsed.request.system)}>
                  <pre className="whitespace-pre-wrap break-words text-xs leading-6">
                    {parsed.request.system}
                  </pre>
                </ContentCard>
              ) : null}

              {orderedInputMessages.map(({ message, originalIndex }) => (
                <MessageCard
                  key={`input-${originalIndex}`}
                  message={message}
                  index={originalIndex}
                />
              ))}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">输入结构解析失败，请查看下方原始 JSON。</p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-base font-semibold">原始 Payload</h3>
          <JsonPanel title="requestPayload" value={item.requestPayload} />
          <JsonPanel title="responsePayload" value={item.responsePayload} />
          <JsonPanel title="error" value={item.error} />
        </section>
      </div>
    </div>
  );
}

function MessageCard({ message, index }: { message: LlmRequestMessage; index: number }) {
  const title = `消息 #${index + 1}`;
  const preview = buildPreview(message.content);

  return (
    <ContentCard title={title} preview={preview}>
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="secondary">{message.role}</Badge>
      </div>
      <pre className="whitespace-pre-wrap break-words text-xs leading-6">{message.content}</pre>

      {message.role === "assistant" && message.toolCalls.length > 0 ? (
        <ToolCallsList toolCalls={message.toolCalls} className="mt-3" />
      ) : null}

      {message.role === "tool" ? (
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          toolCallId: {message.toolCallId}
        </p>
      ) : null}
    </ContentCard>
  );
}

function ToolCallsList({
  toolCalls,
  className,
}: {
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-medium text-muted-foreground">Tool Calls</p>
      <div className="mt-2 space-y-2">
        {toolCalls.map(toolCall => (
          <details key={toolCall.id} className="rounded-md border bg-muted/20 p-2">
            <summary className="cursor-pointer text-xs">
              {toolCall.name} ({toolCall.id})
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6">
              {safeStringify(toolCall.arguments)}
            </pre>
          </details>
        ))}
      </div>
    </div>
  );
}

function ContentCard({
  title,
  preview,
  defaultOpen = false,
  children,
}: {
  title: string;
  preview: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="rounded-md border bg-muted/20 p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {title}
        <span className="ml-2 text-xs font-normal text-muted-foreground">{preview}</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function JsonPanel({
  title,
  value,
  defaultOpen = false,
}: {
  title: string;
  value: unknown;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="rounded-md border bg-muted/20 p-3">
      <summary className="cursor-pointer text-sm font-medium">{title}</summary>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6">
        {safeStringify(value)}
      </pre>
    </details>
  );
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

function buildPreview(content: string): string {
  const singleLine = content.replace(/\s+/g, " ").trim();
  if (singleLine.length === 0) {
    return "(空内容)";
  }

  if (singleLine.length <= 60) {
    return singleLine;
  }

  return `${singleLine.slice(0, 60)}...`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
