export type ApiRequestResult = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  contentType: string | null;
  body: unknown;
  rawBody: string | null;
};

type ApiRequestWithSchemaParams<T> = {
  path: string;
  schema: { parse: (value: unknown) => T };
  init?: RequestInit;
};

const DEFAULT_API_BASE_PATH = "/api";

export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: unknown;
  readonly result: ApiRequestResult;

  constructor(result: ApiRequestResult) {
    super(resolveApiErrorMessage(result));
    this.name = "ApiError";
    this.status = result.status;
    this.statusText = result.statusText;
    this.body = result.body;
    this.result = result;
  }
}

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  const baseUrl =
    configuredBaseUrl && configuredBaseUrl.length > 0 ? configuredBaseUrl : DEFAULT_API_BASE_PATH;

  return `${baseUrl.replace(/\/+$/, "")}${normalizedPath}`;
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function getApiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "请求失败，请稍后再试";
}

async function apiRequest(path: string, init?: RequestInit): Promise<ApiRequestResult> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(buildApiUrl(path), {
    ...init,
    headers,
  });

  const contentType = res.headers.get("content-type");
  const rawText = await res.text();
  let body: unknown = null;
  if (rawText.length > 0) {
    if (contentType?.includes("application/json")) {
      try {
        body = JSON.parse(rawText);
      } catch {
        body = rawText;
      }
    } else {
      body = rawText;
    }
  }

  const result: ApiRequestResult = {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers: Object.fromEntries(res.headers.entries()),
    contentType,
    body,
    rawBody: rawText.length > 0 ? rawText : null,
  };

  if (!result.ok) {
    throw new ApiError(result);
  }

  return result;
}

async function apiRequestWithSchema<T>({
  path,
  schema,
  init,
}: ApiRequestWithSchemaParams<T>): Promise<T> {
  const result = await apiRequest(path, init);
  return schema.parse(result.body);
}

async function apiPost(path: string, body?: unknown, init?: Omit<RequestInit, "body" | "method">) {
  return apiRequest(path, {
    ...init,
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function apiGetWithSchema<T>(
  path: string,
  schema: ApiRequestWithSchemaParams<T>["schema"],
  init?: Omit<RequestInit, "method">,
): Promise<T> {
  return apiRequestWithSchema({
    path,
    schema,
    init: {
      ...init,
      method: "GET",
    },
  });
}

async function apiPostWithSchema<T>(
  path: string,
  body: unknown,
  schema: ApiRequestWithSchemaParams<T>["schema"],
  init?: Omit<RequestInit, "body" | "method">,
): Promise<T> {
  return apiRequestWithSchema({
    path,
    schema,
    init: {
      ...init,
      method: "POST",
      body: JSON.stringify(body),
    },
  });
}

function resolveApiErrorMessage(result: ApiRequestResult): string {
  const bodyMessage = readApiErrorBodyMessage(result.body);
  if (bodyMessage) {
    return bodyMessage;
  }

  if (result.statusText) {
    return `请求失败 (${result.status} ${result.statusText})`;
  }

  return `请求失败 (${result.status})`;
}

function readApiErrorBodyMessage(body: unknown): string | null {
  if (typeof body === "string") {
    const trimmed = body.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof body !== "object" || body === null) {
    return null;
  }

  const recordBody = body as Record<string, unknown>;

  for (const key of ["message", "error", "detail"]) {
    const value = recordBody[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  const nestedError =
    typeof recordBody.error === "object" && recordBody.error !== null
      ? (recordBody.error as Record<string, unknown>)
      : null;
  if (nestedError && typeof nestedError.message === "string") {
    const trimmed = nestedError.message.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

export { apiRequest, apiRequestWithSchema, apiPost, apiGetWithSchema, apiPostWithSchema };
