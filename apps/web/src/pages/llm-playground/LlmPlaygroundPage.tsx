import {
  LlmChatRequestPayloadSchema,
  LlmPlaygroundChatRequestSchema,
  LlmPlaygroundChatResponseSchema,
  LlmProviderListResponseSchema,
  type LlmPlaygroundChatRequest,
  type LlmPlaygroundChatResponse,
  type LlmProviderOption,
  type LlmToolCallPayload,
} from "@kagami/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RefreshCcw, SendHorizontal } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch, apiRequest, type ApiRequestResult } from "@/lib/api";

const DEFAULT_REQUEST_TEMPLATE = JSON.stringify(
  {
    messages: [{ role: "user", content: "你好" }],
    tools: [],
    toolChoice: "none",
  },
  null,
  2,
);

type PlaygroundResult = {
  payload: LlmPlaygroundChatRequest;
  response: ApiRequestResult;
  parsedResponse: LlmPlaygroundChatResponse | null;
  responseSchemaError: string | null;
};

const EMPTY_PROVIDERS: LlmProviderOption[] = [];

export function LlmPlaygroundPage() {
  const [selectedProviderId, setSelectedProviderId] = useState<LlmProviderOption["id"] | "">("");
  const [model, setModel] = useState("");
  const [requestJson, setRequestJson] = useState(DEFAULT_REQUEST_TEMPLATE);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  const [lastPayload, setLastPayload] = useState<LlmPlaygroundChatRequest | null>(null);
  const [lastResponse, setLastResponse] = useState<ApiRequestResult | null>(null);
  const [lastParsedResponse, setLastParsedResponse] = useState<LlmPlaygroundChatResponse | null>(
    null,
  );

  const providersQuery = useQuery({
    queryKey: ["llm-providers"],
    queryFn: async () => {
      const response = await apiFetch<unknown>("/llm/providers");
      return LlmProviderListResponseSchema.parse(response);
    },
  });

  const providers = providersQuery.data?.providers ?? EMPTY_PROVIDERS;
  const selectedProvider = useMemo(
    () => providers.find(provider => provider.id === selectedProviderId) ?? providers[0] ?? null,
    [providers, selectedProviderId],
  );

  const requestMutation = useMutation({
    mutationFn: async (payload: LlmPlaygroundChatRequest): Promise<PlaygroundResult> => {
      const response = await apiRequest("/llm/chat", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        return {
          payload,
          response,
          parsedResponse: null,
          responseSchemaError: null,
        };
      }

      const parsedResponse = LlmPlaygroundChatResponseSchema.safeParse(response.body);
      return {
        payload,
        response,
        parsedResponse: parsedResponse.success ? parsedResponse.data : null,
        responseSchemaError: parsedResponse.success
          ? null
          : formatSchemaIssues(parsedResponse.error.issues),
      };
    },
    onMutate: payload => {
      setEditorError(null);
      setResponseError(null);
      setLastPayload(payload);
      setLastResponse(null);
      setLastParsedResponse(null);
    },
    onSuccess: result => {
      setLastPayload(result.payload);
      setLastResponse(result.response);
      setLastParsedResponse(result.parsedResponse);

      if (!result.response.ok) {
        setResponseError(formatHttpError(result.response));
        return;
      }

      if (result.responseSchemaError) {
        setResponseError(`响应结构校验失败：${result.responseSchemaError}`);
      }
    },
    onError: error => {
      setResponseError(error instanceof Error ? error.message : "发送请求失败，请稍后再试");
    },
  });

  function handleProviderChange(nextProviderId: string): void {
    setSelectedProviderId(nextProviderId as LlmProviderOption["id"]);
    const provider = providers.find(item => item.id === nextProviderId);
    if (!provider) {
      return;
    }

    setModel(provider.defaultModel);
  }

  function handleResetTemplate(): void {
    setRequestJson(DEFAULT_REQUEST_TEMPLATE);
    setEditorError(null);
  }

  function handleSubmit(): void {
    if (!selectedProvider) {
      setEditorError("当前没有可用的 provider，请先在服务端配置 LLM 凭证。");
      return;
    }

    const payload = parsePayload({
      provider: selectedProvider.id,
      model,
      requestJson,
    });
    if (!payload.success) {
      setEditorError(payload.error);
      return;
    }

    requestMutation.mutate(payload.data);
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-auto bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.08),_transparent_28%),linear-gradient(180deg,_rgba(248,250,252,0.98),_rgba(241,245,249,0.88))] p-3 md:p-6 xl:overflow-hidden">
      <div className="mx-auto flex w-full max-w-7xl flex-col xl:h-full xl:min-h-0 xl:flex-1">
        <section className="grid grid-cols-1 gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[300px_minmax(0,1fr)] xl:overflow-hidden">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:min-h-0 xl:grid-cols-1 xl:auto-rows-fr xl:overflow-hidden">
            <Panel
              title="Provider"
              description="只显示当前服务端已配置凭证的 provider。"
              className="flex min-h-0 flex-col"
              bodyClassName="min-h-0 flex-1 overflow-auto"
            >
              {providersQuery.isLoading ? (
                <StateHint text="正在读取 provider 列表..." />
              ) : providersQuery.isError ? (
                <StateHint text={providersQuery.error.message} tone="error" />
              ) : providers.length === 0 ? (
                <StateHint text="没有可用 provider，请先在服务端配置 API Key。" tone="warning" />
              ) : (
                <div className="space-y-2">
                  {providers.map(provider => {
                    const isActive = provider.id === selectedProvider?.id;
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                          isActive
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : "bg-background hover:border-primary/40 hover:bg-accent"
                        }`}
                        onClick={() => handleProviderChange(provider.id)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">{provider.id}</p>
                            <p
                              className={`mt-1 text-xs ${
                                isActive ? "text-primary-foreground/80" : "text-muted-foreground"
                              }`}
                            >
                              默认模型：{provider.defaultModel}
                            </p>
                          </div>
                          {provider.isActive ? (
                            <span
                              className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                                isActive
                                  ? "bg-primary-foreground/15 text-primary-foreground"
                                  : "bg-emerald-100 text-emerald-700"
                              }`}
                            >
                              active
                            </span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </Panel>

            <Panel
              title="Model"
              description="可手动覆盖 provider 默认模型，留空时走默认值。"
              className="flex min-h-0 flex-col"
              bodyClassName="flex flex-1 flex-col"
            >
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">模型名称</span>
                <input
                  type="text"
                  value={model}
                  onChange={event => setModel(event.target.value)}
                  placeholder={selectedProvider?.defaultModel ?? "例如 gpt-4o-mini"}
                  disabled={providers.length === 0}
                  className="h-11 rounded-xl border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>

              <div className="mt-4 rounded-xl border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
                <p>当前 provider：{selectedProvider?.id ?? "未选择"}</p>
                <p className="mt-1">回落默认模型：{selectedProvider?.defaultModel ?? "—"}</p>
              </div>
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:min-h-0 xl:overflow-hidden xl:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
            <Panel
              title="Request JSON"
              description="编辑并发送符合 LlmChatRequestPayload 的原始 JSON。"
              className="flex min-h-0 flex-col"
              bodyClassName="flex min-h-0 flex-1 flex-col"
            >
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <Button type="button" onClick={handleSubmit} disabled={requestMutation.isPending}>
                  <SendHorizontal className="mr-2 h-4 w-4" />
                  {requestMutation.isPending ? "发送中..." : "发送请求"}
                </Button>
                <Button type="button" variant="outline" onClick={handleResetTemplate}>
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  重置模板
                </Button>
              </div>

              <textarea
                value={requestJson}
                onChange={event => setRequestJson(event.target.value)}
                spellCheck={false}
                className="min-h-0 flex-1 resize-none overflow-auto rounded-2xl border bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100 outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />

              {editorError ? (
                <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {editorError}
                </div>
              ) : null}
            </Panel>

            <Panel
              title="Response"
              description="查看结构化输出、错误信息和完整原始响应。"
              className="flex min-h-0 flex-col"
              bodyClassName="min-h-0 flex-1 overflow-auto"
            >
              {requestMutation.isPending ? (
                <StateHint text="请求已发出，正在等待模型返回..." />
              ) : lastResponse === null ? (
                <StateHint text="还没有响应结果，发送一次请求后会显示在这里。" />
              ) : (
                <div className="space-y-4">
                  {lastPayload ? (
                    <div className="grid grid-cols-1 gap-3 rounded-2xl border bg-muted/20 p-4 md:grid-cols-3">
                      <MetaItem label="Provider" value={lastPayload.provider} />
                      <MetaItem
                        label="Model"
                        value={
                          lastPayload.model?.trim().length ? lastPayload.model : "使用默认模型"
                        }
                      />
                      <MetaItem
                        label="HTTP"
                        value={`${lastResponse.status} ${lastResponse.statusText}`.trim()}
                      />
                    </div>
                  ) : null}

                  {responseError ? (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      {responseError}
                    </div>
                  ) : null}

                  {lastParsedResponse ? (
                    <>
                      <section className="rounded-2xl border bg-background/80 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <h2 className="text-sm font-semibold">Assistant Output</h2>
                          <span className="text-xs text-muted-foreground">
                            {lastParsedResponse.provider} · {lastParsedResponse.model}
                          </span>
                        </div>
                        <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-muted/30 p-4 text-xs leading-6">
                          {lastParsedResponse.message.content || "模型未返回文本内容。"}
                        </pre>
                      </section>

                      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                        <div className="rounded-2xl border bg-background/80 p-4">
                          <h2 className="text-sm font-semibold">Tool Calls</h2>
                          {lastParsedResponse.message.toolCalls.length === 0 ? (
                            <p className="mt-3 text-sm text-muted-foreground">
                              本次调用没有 tool calls。
                            </p>
                          ) : (
                            <div className="mt-3 space-y-3">
                              {lastParsedResponse.message.toolCalls.map(toolCall => (
                                <ToolCallCard key={toolCall.id} toolCall={toolCall} />
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="rounded-2xl border bg-background/80 p-4">
                          <h2 className="text-sm font-semibold">Usage</h2>
                          {lastParsedResponse.usage ? (
                            <div className="mt-3 space-y-2 text-sm">
                              <MetaItem
                                label="promptTokens"
                                value={String(lastParsedResponse.usage.promptTokens ?? "—")}
                              />
                              <MetaItem
                                label="completionTokens"
                                value={String(lastParsedResponse.usage.completionTokens ?? "—")}
                              />
                              <MetaItem
                                label="totalTokens"
                                value={String(lastParsedResponse.usage.totalTokens ?? "—")}
                              />
                            </div>
                          ) : (
                            <p className="mt-3 text-sm text-muted-foreground">
                              本次响应没有 usage 信息。
                            </p>
                          )}
                        </div>
                      </section>
                    </>
                  ) : null}

                  <section className="rounded-2xl border bg-background/80 p-4">
                    <h2 className="text-sm font-semibold">Raw Response</h2>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100">
                      {formatJson(lastResponse.body)}
                    </pre>
                  </section>
                </div>
              )}
            </Panel>
          </div>
        </section>
      </div>
    </div>
  );
}

function parsePayload({
  provider,
  model,
  requestJson,
}: {
  provider: LlmProviderOption["id"];
  model: string;
  requestJson: string;
}):
  | {
      success: true;
      data: LlmPlaygroundChatRequest;
    }
  | {
      success: false;
      error: string;
    } {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(requestJson);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? `JSON 解析失败：${error.message}` : "JSON 解析失败",
    };
  }

  const requestParsed = LlmChatRequestPayloadSchema.safeParse(parsedJson);
  if (!requestParsed.success) {
    return {
      success: false,
      error: `请求结构校验失败：${formatSchemaIssues(requestParsed.error.issues)}`,
    };
  }

  const payloadParsed = LlmPlaygroundChatRequestSchema.safeParse({
    provider,
    model,
    request: requestParsed.data,
  });

  if (!payloadParsed.success) {
    return {
      success: false,
      error: `提交参数校验失败：${formatSchemaIssues(payloadParsed.error.issues)}`,
    };
  }

  return {
    success: true,
    data: payloadParsed.data,
  };
}

function formatSchemaIssues(
  issues: Array<{
    path: Array<string | number>;
    message: string;
  }>,
): string {
  return issues
    .map(issue => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function formatHttpError(response: ApiRequestResult): string {
  const body =
    typeof response.body === "string"
      ? response.body
      : response.body
        ? formatJson(response.body)
        : "";
  return [`HTTP ${response.status} ${response.statusText}`.trim(), body].filter(Boolean).join("\n");
}

function formatJson(value: unknown): string {
  const formatted = JSON.stringify(value, null, 2);
  return formatted ?? "null";
}

function Panel({
  title,
  description,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  description: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border bg-background/88 p-5 shadow-sm backdrop-blur ${className ?? ""}`}
    >
      <div className="mb-4 space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

function StateHint({
  text,
  tone = "default",
}: {
  text: string;
  tone?: "default" | "warning" | "error";
}) {
  const toneClassName =
    tone === "error"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-dashed bg-muted/20 text-muted-foreground";

  return (
    <div
      className={`flex min-h-[140px] items-center justify-center rounded-2xl border px-4 py-6 text-center text-sm ${toneClassName}`}
    >
      {text}
    </div>
  );
}

function ToolCallCard({ toolCall }: { toolCall: LlmToolCallPayload }) {
  return (
    <details className="rounded-xl border bg-muted/20 p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {toolCall.name}
        <span className="ml-2 font-mono text-xs text-muted-foreground">{toolCall.id}</span>
      </summary>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 font-mono text-xs leading-6 text-slate-100">
        {formatJson(toolCall.arguments)}
      </pre>
    </details>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="break-words text-sm font-medium">{value}</p>
    </div>
  );
}
