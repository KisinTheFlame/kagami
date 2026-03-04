import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type LlmChatCallItem = {
  id: number;
  requestId: string;
  provider: string;
  model: string;
  status: "success" | "failed";
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  latencyMs: number | null;
  createdAt: string;
};

type LlmChatCallListResponse = {
  page: number;
  pageSize: number;
  hasMore: boolean;
  items: LlmChatCallItem[];
};

export function useLlmChatCallList(page: number, pageSize: number) {
  return useQuery({
    queryKey: ["llm-chat-call", page, pageSize],
    queryFn: () =>
      apiFetch<LlmChatCallListResponse>(`/llm-chat-call/query?page=${page}&pageSize=${pageSize}`),
  });
}
