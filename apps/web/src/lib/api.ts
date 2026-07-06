const DEFAULT_API_BASE_PATH = "/api";

/** 解析 API base（VITE_API_BASE_URL 覆盖，缺省 /api），去尾斜杠。RPC client 与 buildApiUrl 共用。 */
export function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  const base = configured && configured.length > 0 ? configured : DEFAULT_API_BASE_PATH;
  return base.replace(/\/+$/, "");
}

/** 拼出一个后端资源的完整 URL（如 OSS 对象预览图的 src），走同一套 base 解析。 */
export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${resolveApiBaseUrl()}${normalizedPath}`;
}

/** 把任意抛出的错误映射成展示文案。RPC client 的错误已在 decodeError 里把 message 备好。 */
export function getApiErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "请求失败，请稍后再试";
}
