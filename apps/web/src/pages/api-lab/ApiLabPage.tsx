import {
  AppLogListQuerySchema,
  HealthQuerySchema,
  LlmChatCallListQuerySchema,
  NapcatEventListQuerySchema,
  NapcatSendGroupMessageRequestSchema,
  z,
} from "@kagami/shared";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { apiRequest, type ApiRequestResult } from "@/lib/api";
import { generateFieldsFromSchema, type GeneratedField } from "./schema-fields";

type ApiState = "idle" | "loading" | "success" | "error";
type FieldScope = "query" | "body";

type ApiLabEndpointSpec = {
  id: string;
  label: string;
  method: "GET" | "POST";
  path: string;
  description: string;
  querySchema: z.ZodTypeAny;
  bodySchema: z.ZodTypeAny;
};

type PreparedRequest = {
  method: ApiLabEndpointSpec["method"];
  path: string;
  url: string;
  query: Record<string, unknown>;
  body: Record<string, unknown> | null;
};

type RequestSummary = PreparedRequest & {
  sentAt: string;
};

type ResponseSummary = ApiRequestResult & {
  receivedAt: string;
};

type ApiLabEndpoint = ApiLabEndpointSpec & {
  queryFields: GeneratedField[];
  bodyFields: GeneratedField[];
};

const EMPTY_INPUT_SCHEMA = z.object({});

const API_LAB_ENDPOINT_SPECS: ApiLabEndpointSpec[] = [
  {
    id: "health",
    label: "健康检查",
    method: "GET",
    path: "/health",
    description: "查询服务健康状态",
    querySchema: HealthQuerySchema,
    bodySchema: EMPTY_INPUT_SCHEMA,
  },
  {
    id: "app-log-query",
    label: "应用日志查询",
    method: "GET",
    path: "/app-log/query",
    description: "按条件查询应用日志",
    querySchema: AppLogListQuerySchema,
    bodySchema: EMPTY_INPUT_SCHEMA,
  },
  {
    id: "llm-chat-call-query",
    label: "LLM 调用查询",
    method: "GET",
    path: "/llm-chat-call/query",
    description: "查询 LLM 调用历史",
    querySchema: LlmChatCallListQuerySchema,
    bodySchema: EMPTY_INPUT_SCHEMA,
  },
  {
    id: "napcat-event-query",
    label: "NapCat 事件查询",
    method: "GET",
    path: "/napcat-event/query",
    description: "查询 NapCat 事件记录",
    querySchema: NapcatEventListQuerySchema,
    bodySchema: EMPTY_INPUT_SCHEMA,
  },
  {
    id: "napcat-group-send",
    label: "NapCat 发送群聊",
    method: "POST",
    path: "/napcat/group/send",
    description: "发送群聊文本消息",
    querySchema: EMPTY_INPUT_SCHEMA,
    bodySchema: NapcatSendGroupMessageRequestSchema,
  },
];

const ENDPOINTS: ApiLabEndpoint[] = API_LAB_ENDPOINT_SPECS.map(endpoint => ({
  ...endpoint,
  queryFields: generateFieldsFromSchema(endpoint.querySchema),
  bodyFields: generateFieldsFromSchema(endpoint.bodySchema),
}));

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function getFormKey(scope: FieldScope, fieldName: string): string {
  return `${scope}.${fieldName}`;
}

function createDefaultFormValues(endpoint: ApiLabEndpoint): Record<string, string> {
  const entries: Array<[string, string]> = [];

  for (const field of endpoint.queryFields) {
    entries.push([getFormKey("query", field.name), field.defaultValue ?? ""]);
  }
  for (const field of endpoint.bodyFields) {
    entries.push([getFormKey("body", field.name), field.defaultValue ?? ""]);
  }

  return Object.fromEntries(entries);
}

function collectScopeInput({
  scope,
  fields,
  values,
}: {
  scope: FieldScope;
  fields: GeneratedField[];
  values: Record<string, string>;
}): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const key = getFormKey(scope, field.name);
    const rawValue = values[key] ?? "";
    if (rawValue.length === 0 && !field.required) {
      continue;
    }
    result[field.name] = toSchemaInputValue(field, rawValue);
  }
  return result;
}

function toSchemaInputValue(field: GeneratedField, rawValue: string): unknown {
  if (field.type === "number") {
    const trimmed = rawValue.trim();
    if (trimmed.length === 0) {
      return rawValue;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    return rawValue;
  }

  if (field.type === "datetime") {
    if (rawValue.length === 0) {
      return rawValue;
    }
    const parsedDate = new Date(rawValue);
    if (Number.isNaN(parsedDate.getTime())) {
      return rawValue;
    }
    return parsedDate.toISOString();
  }

  return rawValue;
}

function prepareRequest(
  endpoint: ApiLabEndpoint,
  values: Record<string, string>,
): { request?: PreparedRequest; error?: string } {
  const queryInput = collectScopeInput({
    scope: "query",
    fields: endpoint.queryFields,
    values,
  });
  const queryParsed = endpoint.querySchema.safeParse(queryInput);
  if (!queryParsed.success) {
    return { error: formatSchemaError("query", queryParsed.error.issues) };
  }

  const bodyInput = collectScopeInput({
    scope: "body",
    fields: endpoint.bodyFields,
    values,
  });

  const bodyParsed = endpoint.bodySchema.safeParse(bodyInput);
  if (!bodyParsed.success) {
    return { error: formatSchemaError("body", bodyParsed.error.issues) };
  }

  const query = toRecord(queryParsed.data);
  const body = toRecord(bodyParsed.data);

  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
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

function formatSchemaError(scope: FieldScope, issues: z.ZodIssue[]): string {
  return issues
    .map(issue => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${scope}.${path}: ${issue.message}`;
    })
    .join("; ");
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function getMethodClassName(method: ApiLabEndpointSpec["method"]): string {
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

  function renderField(scope: FieldScope, field: GeneratedField) {
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
          min={field.min}
          max={field.max}
          step={field.type === "number" ? (field.numberMode === "integer" ? 1 : "any") : undefined}
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
