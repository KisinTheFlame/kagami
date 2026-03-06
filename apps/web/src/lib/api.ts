async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export type ApiRequestResult = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  contentType: string | null;
  body: unknown;
  rawBody: string | null;
};

async function apiRequest(path: string, init?: RequestInit): Promise<ApiRequestResult> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`/api${path}`, {
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

  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers: Object.fromEntries(res.headers.entries()),
    contentType,
    body,
    rawBody: rawText.length > 0 ? rawText : null,
  };
}

export { apiFetch, apiRequest };
