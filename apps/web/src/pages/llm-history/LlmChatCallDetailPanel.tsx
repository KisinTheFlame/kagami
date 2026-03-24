import type { LlmChatCallItem } from "@kagami/shared";
import { FlaskConical } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildPlaygroundImportDraftFromHistory,
  type PlaygroundImportLocationState,
} from "@/pages/llm-playground/playground-import";
import {
  parseLlmChatCallDetail,
  type ParsedLlmRequestMessage,
  type ParsedLlmUserContentPart,
} from "./llm-chat-call-detail-parser";

type LlmChatCallDetailPanelProps = {
  item: LlmChatCallItem | null;
};

type InputEntry =
  | {
      type: "system";
      content: string;
    }
  | {
      type: "message";
      message: ParsedLlmRequestMessage;
      originalIndex: number;
    };

export function LlmChatCallDetailPanel({ item }: LlmChatCallDetailPanelProps) {
  const navigate = useNavigate();
  const [inputOrder, setInputOrder] = useState<"asc" | "desc">("desc");
  const parsed = useMemo(() => (item ? parseLlmChatCallDetail(item) : null), [item]);
  const importDraft = useMemo(() => {
    if (item === null || !parsed?.request) {
      return null;
    }

    return buildPlaygroundImportDraftFromHistory({
      item,
      request: parsed.request,
    });
  }, [item, parsed]);
  const orderedInputEntries = useMemo(() => {
    if (!parsed?.request) {
      return [] as InputEntry[];
    }

    const messageEntries: InputEntry[] = parsed.request.messages.map((message, index) => ({
      type: "message" as const,
      message,
      originalIndex: index,
    }));
    const systemEntry: InputEntry | null = parsed.request.system
      ? {
          type: "system",
          content: parsed.request.system,
        }
      : null;

    if (inputOrder === "asc") {
      return systemEntry ? [systemEntry, ...messageEntries] : messageEntries;
    }

    return systemEntry
      ? [...messageEntries].reverse().concat(systemEntry)
      : [...messageEntries].reverse();
  }, [inputOrder, parsed]);
  const toolNames = useMemo(() => {
    if (!parsed?.request) {
      return [];
    }

    return [...new Set(parsed.request.tools.map(tool => tool.name))];
  }, [parsed]);

  if (item === null || parsed === null) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="text-sm text-muted-foreground">暂无选中记录</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-5 py-4">
        <div className="grid grid-cols-1 gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <MetaItem label="Request ID" value={item.requestId} mono />
          <MetaItem label="Attempt Seq" value={`#${item.seq}`} mono />
          <MetaItem label="Provider" value={item.provider} />
          <MetaItem label="Model" value={item.model} />
          <MetaItem label="实际 Model" value={readActualModel(item.extension) ?? "—"} />
          <MetaItem label="状态" value={toStatusLabel(item.status)} />
          <MetaItem label="延迟" value={item.latencyMs === null ? "—" : `${item.latencyMs} ms`} />
          <MetaItem label="时间" value={formatDate(item.createdAt)} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() =>
              importDraft
                ? navigate("/llm-playground", {
                    state: {
                      playgroundImport: importDraft,
                    } satisfies PlaygroundImportLocationState,
                  })
                : undefined
            }
            disabled={importDraft === null}
          >
            <FlaskConical className="mr-2 h-4 w-4" />
            导入到 Playground
          </Button>
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
                  preview={buildMessagePreview({
                    content: parsed.response.message.content,
                    toolCalls: parsed.response.message.toolCalls,
                  })}
                >
                  <MessageContent
                    content={parsed.response.message.content}
                    emptyHint={
                      parsed.response.message.toolCalls.length > 0
                        ? "该输出仅包含工具调用。"
                        : undefined
                    }
                  />
                  {parsed.response.message.toolCalls.length > 0 ? (
                    <ToolCallsList toolCalls={parsed.response.message.toolCalls} className="mt-3" />
                  ) : null}
                </ContentCard>

                {parsed.response.usage ? (
                  <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                    promptTokens: {parsed.response.usage.promptTokens ?? "—"} | completionTokens:{" "}
                    {parsed.response.usage.completionTokens ?? "—"} | totalTokens:{" "}
                    {parsed.response.usage.totalTokens ?? "—"} | cacheHitTokens:{" "}
                    {parsed.response.usage.cacheHitTokens ?? "—"} | cacheMissTokens:{" "}
                    {parsed.response.usage.cacheMissTokens ?? "—"}
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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
              {orderedInputEntries.map(entry =>
                entry.type === "system" ? (
                  <ContentCard
                    key="input-system"
                    title="System Prompt"
                    preview={buildPreview(entry.content)}
                  >
                    <pre className="whitespace-pre-wrap break-words text-xs leading-6">
                      {entry.content}
                    </pre>
                  </ContentCard>
                ) : (
                  <MessageCard
                    key={`input-${entry.originalIndex}`}
                    message={entry.message}
                    index={entry.originalIndex}
                  />
                ),
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">输入结构解析失败，请查看下方原始 JSON。</p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-base font-semibold">提供的工具</h3>
          {!parsed?.request ? (
            <p className="text-sm text-muted-foreground">输入结构解析失败，无法展示工具列表。</p>
          ) : toolNames.length === 0 ? (
            <p className="text-sm text-muted-foreground">本次请求没有提供工具。</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {toolNames.map(toolName => (
                <Badge key={toolName} variant="secondary">
                  {toolName}
                </Badge>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-base font-semibold">原始 Payload</h3>
          <JsonPanel title="requestPayload" value={item.requestPayload} />
          <JsonPanel title="responsePayload" value={item.responsePayload} />
          <JsonPanel title="error" value={item.error} />
        </section>

        <section className="space-y-3">
          <h3 className="text-base font-semibold">Native Payload</h3>
          <JsonPanel title="nativeRequestPayload" value={item.nativeRequestPayload} />
          <JsonPanel title="nativeResponsePayload" value={item.nativeResponsePayload} />
          <JsonPanel title="nativeError" value={item.nativeError} />
        </section>
      </div>
    </div>
  );
}

function readActualModel(extension: Record<string, unknown> | null): string | null {
  if (!extension) {
    return null;
  }

  const metadata = extension.metadata;
  if (!isRecord(metadata)) {
    return null;
  }

  return typeof metadata.actualModel === "string" && metadata.actualModel.trim().length > 0
    ? metadata.actualModel
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function MessageCard({ message, index }: { message: ParsedLlmRequestMessage; index: number }) {
  const title = `消息 #${index + 1}`;
  const preview = buildMessagePreview({
    content: renderMessageContent(message.content),
    toolCalls: message.role === "assistant" ? message.toolCalls : [],
  });

  return (
    <ContentCard title={title} preview={preview}>
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="secondary">{message.role}</Badge>
      </div>
      <MessageContent
        content={renderMessageContent(message.content)}
        emptyHint={
          message.role === "assistant" && message.toolCalls.length > 0
            ? "该消息仅包含工具调用。"
            : undefined
        }
      />

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

function MessageContent({ content, emptyHint }: { content: string; emptyHint?: string }) {
  const normalizedContent = content.trim();
  if (normalizedContent.length === 0) {
    return emptyHint ? <p className="text-xs text-muted-foreground">{emptyHint}</p> : null;
  }

  return <pre className="whitespace-pre-wrap break-words text-xs leading-6">{content}</pre>;
}

function renderMessageContent(content: ParsedLlmRequestMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  return content.map(renderUserContentPart).join("\n");
}

function renderUserContentPart(part: ParsedLlmUserContentPart): string {
  if (part.type === "text") {
    return part.text;
  }

  const segments = [
    part.mimeType,
    part.filename ? `filename=${part.filename}` : null,
    typeof part.sizeBytes === "number" ? `size=${formatBytes(part.sizeBytes)}` : null,
  ].filter(Boolean);

  return segments.length > 0 ? `[图片] ${segments.join(" | ")}` : "[图片]";
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
          <details key={toolCall.id} open className="rounded-md border bg-muted/20 p-2">
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
        <span className="mt-1 block text-xs font-normal text-muted-foreground sm:ml-2 sm:mt-0 sm:inline">
          {preview}
        </span>
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

function toStatusLabel(status: LlmChatCallItem["status"]): string {
  return status === "success" ? "成功" : "失败";
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

function buildMessagePreview({
  content,
  toolCalls = [],
}: {
  content: string;
  toolCalls?: Array<{ name: string }>;
}): string {
  const contentPreview = buildPreview(content);
  if (contentPreview !== "(空内容)") {
    return contentPreview;
  }

  if (toolCalls.length === 0) {
    return contentPreview;
  }

  const toolNames = toolCalls.slice(0, 2).map(toolCall => toolCall.name);
  const remainingCount = toolCalls.length - toolNames.length;
  const summary =
    remainingCount > 0
      ? `${toolNames.join("、")} 等 ${toolCalls.length} 个工具`
      : toolNames.join("、");

  return `工具调用: ${summary}`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
