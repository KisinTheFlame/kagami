import type { AppLogLevel, LlmChatCallStatus } from "@kagami/shared";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { apiRequest, type ApiRequestResult } from "@/lib/api";

type ApiState = "idle" | "loading" | "success" | "error";
type FieldScope = "query" | "body";
type FieldType = "text" | "textarea" | "number" | "datetime" | "select";

type SelectOption = {
  label: string;
  value: string;
};

type EndpointField = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  options?: SelectOption[];
  min?: number;
  max?: number;
};

type EndpointConfig = {
  id: string;
  label: string;
  method: "GET" | "POST";
  path: string;
  description: string;
  queryFields: EndpointField[];
  bodyFields: EndpointField[];
};

type PreparedRequest = {
  method: EndpointConfig["method"];
  path: string;
  url: string;
  query: Record<string, string | number>;
  body: Record<string, unknown> | null;
};

type RequestSummary = PreparedRequest & {
  sentAt: string;
};

type ResponseSummary = ApiRequestResult & {
  receivedAt: string;
};

const APP_LOG_LEVEL_OPTIONS: SelectOption[] = [
  { label: "debug", value: "debug" satisfies AppLogLevel },
  { label: "info", value: "info" satisfies AppLogLevel },
  { label: "warn", value: "warn" satisfies AppLogLevel },
  { label: "error", value: "error" satisfies AppLogLevel },
  { label: "fatal", value: "fatal" satisfies AppLogLevel },
];

const LLM_CHAT_STATUS_OPTIONS: SelectOption[] = [
  { label: "success", value: "success" satisfies LlmChatCallStatus },
  { label: "failed", value: "failed" satisfies LlmChatCallStatus },
];

const ENDPOINTS: EndpointConfig[] = [
  {
    id: "health",
    label: "健康检查",
    method: "GET",
    path: "/health",
    description: "查询服务健康状态",
    queryFields: [],
    bodyFields: [],
  },
  {
    id: "app-log-query",
    label: "应用日志查询",
    method: "GET",
    path: "/app-log/query",
    description: "按条件查询应用日志",
    queryFields: [
      { name: "page", label: "页码", type: "number", required: true, defaultValue: "1", min: 1 },
      {
        name: "pageSize",
        label: "每页数量",
        type: "number",
        required: true,
        defaultValue: "20",
        min: 1,
        max: 100,
      },
      { name: "level", label: "级别", type: "select", options: APP_LOG_LEVEL_OPTIONS },
      { name: "traceId", label: "Trace ID", type: "text", placeholder: "精确匹配" },
      { name: "message", label: "Message 关键词", type: "text", placeholder: "包含匹配" },
      { name: "source", label: "Source 关键词", type: "text", placeholder: "包含匹配" },
      { name: "startAt", label: "开始时间", type: "datetime" },
      { name: "endAt", label: "结束时间", type: "datetime" },
    ],
    bodyFields: [],
  },
  {
    id: "llm-chat-call-query",
    label: "LLM 调用查询",
    method: "GET",
    path: "/llm-chat-call/query",
    description: "查询 LLM 调用历史",
    queryFields: [
      { name: "page", label: "页码", type: "number", required: true, defaultValue: "1", min: 1 },
      {
        name: "pageSize",
        label: "每页数量",
        type: "number",
        required: true,
        defaultValue: "20",
        min: 1,
        max: 100,
      },
      { name: "status", label: "状态", type: "select", options: LLM_CHAT_STATUS_OPTIONS },
    ],
    bodyFields: [],
  },
  {
    id: "napcat-event-query",
    label: "NapCat 事件查询",
    method: "GET",
    path: "/napcat-event/query",
    description: "查询 NapCat 事件记录",
    queryFields: [
      { name: "page", label: "页码", type: "number", required: true, defaultValue: "1", min: 1 },
      {
        name: "pageSize",
        label: "每页数量",
        type: "number",
        required: true,
        defaultValue: "20",
        min: 1,
        max: 100,
      },
      { name: "postType", label: "Post Type", type: "text", placeholder: "例如 message" },
      { name: "messageType", label: "Message Type", type: "text", placeholder: "例如 private" },
      { name: "userId", label: "User ID", type: "text" },
      { name: "keyword", label: "关键词", type: "text", placeholder: "按 rawMessage 搜索" },
      { name: "startAt", label: "开始时间", type: "datetime" },
      { name: "endAt", label: "结束时间", type: "datetime" },
    ],
    bodyFields: [],
  },
  {
    id: "napcat-private-send",
    label: "NapCat 发送私聊",
    method: "POST",
    path: "/napcat/private/send",
    description: "发送私聊文本消息",
    queryFields: [],
    bodyFields: [
      { name: "userId", label: "User ID", type: "text", required: true },
      { name: "message", label: "消息内容", type: "textarea", required: true },
    ],
  },
  {
    id: "napcat-group-send",
    label: "NapCat 发送群聊",
    method: "POST",
    path: "/napcat/group/send",
    description: "发送群聊文本消息",
    queryFields: [],
    bodyFields: [
      { name: "groupId", label: "Group ID", type: "text", required: true },
      { name: "message", label: "消息内容", type: "textarea", required: true },
    ],
  },
];

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function getFormKey(scope: FieldScope, fieldName: string): string {
  return `${scope}.${fieldName}`;
}

function createDefaultFormValues(endpoint: EndpointConfig): Record<string, string> {
  const entries: Array<[string, string]> = [];

  for (const field of endpoint.queryFields) {
    entries.push([getFormKey("query", field.name), field.defaultValue ?? ""]);
  }
  for (const field of endpoint.bodyFields) {
    entries.push([getFormKey("body", field.name), field.defaultValue ?? ""]);
  }

  return Object.fromEntries(entries);
}

function parseFieldValue(
  field: EndpointField,
  rawValue: string,
): {
  hasValue: boolean;
  value?: string | number;
  error?: string;
} {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    if (field.required) {
      return {
        hasValue: false,
        error: `${field.label}不能为空`,
      };
    }
    return { hasValue: false };
  }

  if (field.type === "number") {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      return {
        hasValue: false,
        error: `${field.label}必须是整数`,
      };
    }
    if (field.min !== undefined && parsed < field.min) {
      return {
        hasValue: false,
        error: `${field.label}不能小于 ${field.min}`,
      };
    }
    if (field.max !== undefined && parsed > field.max) {
      return {
        hasValue: false,
        error: `${field.label}不能大于 ${field.max}`,
      };
    }
    return {
      hasValue: true,
      value: parsed,
    };
  }

  if (field.type === "datetime") {
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) {
      return {
        hasValue: false,
        error: `${field.label}不是合法时间`,
      };
    }
    return {
      hasValue: true,
      value: date.toISOString(),
    };
  }

  if (field.type === "textarea") {
    return {
      hasValue: true,
      value: rawValue,
    };
  }

  return {
    hasValue: true,
    value: trimmed,
  };
}

function prepareRequest(
  endpoint: EndpointConfig,
  values: Record<string, string>,
): { request?: PreparedRequest; error?: string } {
  const query: Record<string, string | number> = {};
  const body: Record<string, unknown> = {};

  for (const field of endpoint.queryFields) {
    const valueKey = getFormKey("query", field.name);
    const parsed = parseFieldValue(field, values[valueKey] ?? "");
    if (parsed.error) {
      return { error: parsed.error };
    }
    if (parsed.hasValue) {
      query[field.name] = parsed.value as string | number;
    }
  }

  for (const field of endpoint.bodyFields) {
    const valueKey = getFormKey("body", field.name);
    const parsed = parseFieldValue(field, values[valueKey] ?? "");
    if (parsed.error) {
      return { error: parsed.error };
    }
    if (parsed.hasValue) {
      body[field.name] = parsed.value as string | number;
    }
  }

  const startAt = query.startAt;
  const endAt = query.endAt;
  if (typeof startAt === "string" && typeof endAt === "string") {
    const startAtMs = new Date(startAt).getTime();
    const endAtMs = new Date(endAt).getTime();
    if (startAtMs > endAtMs) {
      return { error: "开始时间不能晚于结束时间" };
    }
  }

  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    queryParams.set(key, String(value));
  }
  const queryString = queryParams.toString();

  return {
    request: {
      method: endpoint.method,
      path: endpoint.path,
      url: queryString.length > 0 ? `${endpoint.path}?${queryString}` : endpoint.path,
      query,
      body: endpoint.method === "POST" ? body : null,
    },
  };
}

function getMethodClassName(method: EndpointConfig["method"]): string {
  if (method === "POST") {
    return "bg-blue-100 text-blue-800";
  }

  return "bg-emerald-100 text-emerald-800";
}

export function ApiLabPage() {
  const [selectedEndpointId, setSelectedEndpointId] = useState<string>(ENDPOINTS[0].id);
  const [formValues, setFormValues] = useState<Record<string, string>>(() =>
    createDefaultFormValues(ENDPOINTS[0]),
  );
  const [apiState, setApiState] = useState<ApiState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<RequestSummary | null>(null);
  const [lastResponse, setLastResponse] = useState<ResponseSummary | null>(null);

  const selectedEndpoint = useMemo(
    () => ENDPOINTS.find(item => item.id === selectedEndpointId) ?? ENDPOINTS[0],
    [selectedEndpointId],
  );

  const requestMutation = useMutation({
    mutationFn: async (request: PreparedRequest) => {
      const response = await apiRequest(request.url, {
        method: request.method,
        body: request.body ? JSON.stringify(request.body) : undefined,
      });
      return {
        request,
        response,
      };
    },
    onMutate: request => {
      setApiState("loading");
      setErrorMessage(null);
      setLastRequest({
        ...request,
        sentAt: new Date().toISOString(),
      });
      setLastResponse(null);
    },
    onSuccess: ({ response }) => {
      if (response.ok) {
        setApiState("success");
      } else {
        setApiState("error");
        setErrorMessage(`HTTP ${response.status} ${response.statusText}`.trim());
      }

      setLastResponse({
        ...response,
        receivedAt: new Date().toISOString(),
      });
    },
    onError: error => {
      setApiState("error");
      setErrorMessage(error instanceof Error ? error.message : "网络请求失败，请稍后再试");
    },
  });

  function handleFieldChange(scope: FieldScope, fieldName: string, nextValue: string): void {
    const key = getFormKey(scope, fieldName);
    setFormValues(prev => ({
      ...prev,
      [key]: nextValue,
    }));
  }

  function handleEndpointChange(nextEndpointId: string): void {
    const nextEndpoint = ENDPOINTS.find(item => item.id === nextEndpointId) ?? ENDPOINTS[0];
    setSelectedEndpointId(nextEndpoint.id);
    setFormValues(createDefaultFormValues(nextEndpoint));
    setApiState("idle");
    setErrorMessage(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const result = prepareRequest(selectedEndpoint, formValues);
    if (!result.request) {
      setApiState("error");
      setErrorMessage(result.error ?? "表单参数不合法");
      return;
    }

    requestMutation.mutate(result.request);
  }

  function renderField(scope: FieldScope, field: EndpointField) {
    const key = getFormKey(scope, field.name);
    const value = formValues[key] ?? "";

    if (field.type === "select") {
      return (
        <label key={key} className="space-y-1">
          <span className="text-sm font-medium">
            {field.label}
            {field.required ? " *" : ""}
          </span>
          <select
            value={value}
            onChange={event => handleFieldChange(scope, field.name, event.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">未填写</option>
            {(field.options ?? []).map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (field.type === "textarea") {
      return (
        <label key={key} className="space-y-1 md:col-span-2">
          <span className="text-sm font-medium">
            {field.label}
            {field.required ? " *" : ""}
          </span>
          <textarea
            value={value}
            onChange={event => handleFieldChange(scope, field.name, event.target.value)}
            placeholder={field.placeholder}
            className="min-h-28 w-full rounded-md border bg-background p-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </label>
      );
    }

    return (
      <label key={key} className="space-y-1">
        <span className="text-sm font-medium">
          {field.label}
          {field.required ? " *" : ""}
        </span>
        <input
          type={
            field.type === "datetime"
              ? "datetime-local"
              : field.type === "number"
                ? "number"
                : "text"
          }
          value={value}
          onChange={event => handleFieldChange(scope, field.name, event.target.value)}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          step={field.type === "number" ? 1 : undefined}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </label>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden p-6">
      <header className="space-y-2">
        <h1 className="text-lg font-semibold">后端接口测试台</h1>
        <p className="text-sm text-muted-foreground">
          选择预置接口并填写字段，直接发起调试请求。无需手写 JSON。
        </p>
      </header>

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
        <aside className="flex w-full min-h-0 flex-col rounded-md border xl:w-72">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-medium">可用接口</h2>
            <p className="mt-1 text-xs text-muted-foreground">点击左侧接口后在右侧调试</p>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
            {ENDPOINTS.map(endpoint => {
              const isActive = endpoint.id === selectedEndpoint.id;
              return (
                <button
                  key={endpoint.id}
                  type="button"
                  onClick={() => handleEndpointChange(endpoint.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    isActive
                      ? "border-primary bg-accent"
                      : "border-transparent hover:border-border hover:bg-accent/60"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${getMethodClassName(endpoint.method)}`}
                    >
                      {endpoint.method}
                    </span>
                    <span className="font-medium">{endpoint.label}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{endpoint.path}</p>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          <form onSubmit={handleSubmit} className="space-y-4 rounded-md border p-4">
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2">
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${getMethodClassName(selectedEndpoint.method)}`}
              >
                {selectedEndpoint.method}
              </span>
              <code className="text-sm">{selectedEndpoint.path}</code>
              <span className="text-sm text-muted-foreground">{selectedEndpoint.description}</span>
            </div>

            {selectedEndpoint.queryFields.length > 0 ? (
              <section className="space-y-3 rounded-md border p-3">
                <h2 className="text-sm font-medium">Query 参数</h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {selectedEndpoint.queryFields.map(field => renderField("query", field))}
                </div>
              </section>
            ) : null}

            {selectedEndpoint.bodyFields.length > 0 ? (
              <section className="space-y-3 rounded-md border p-3">
                <h2 className="text-sm font-medium">Body 参数</h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {selectedEndpoint.bodyFields.map(field => renderField("body", field))}
                </div>
              </section>
            ) : null}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={requestMutation.isPending}>
                {requestMutation.isPending ? "发送中..." : "发送请求"}
              </Button>
              <span className="text-sm text-muted-foreground">状态：{apiState}</span>
            </div>
            {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
          </form>

          <section className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="flex min-h-0 flex-col space-y-2 rounded-md border p-4">
              <h2 className="text-sm font-medium">最后一次请求</h2>
              <pre className="min-h-0 flex-1 overflow-auto rounded bg-muted p-3 text-xs">
                {lastRequest ? formatJson(lastRequest) : "暂无请求"}
              </pre>
            </div>
            <div className="flex min-h-0 flex-col space-y-2 rounded-md border p-4">
              <h2 className="text-sm font-medium">最后一次响应</h2>
              <pre className="min-h-0 flex-1 overflow-auto rounded bg-muted p-3 text-xs">
                {lastResponse ? formatJson(lastResponse) : "暂无响应"}
              </pre>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
