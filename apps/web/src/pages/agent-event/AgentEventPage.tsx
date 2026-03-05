import {
  AgentEventEnqueueRequestSchema,
  AgentEventEnqueueResponseSchema,
  type AgentEventEnqueueRequest,
  type AgentEventEnqueueResponse,
} from "@kagami/shared";
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

type ApiState = "idle" | "loading" | "success" | "error";

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function AgentEventPage() {
  const [message, setMessage] = useState("");
  const [apiState, setApiState] = useState<ApiState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<AgentEventEnqueueRequest | null>(null);
  const [lastResponse, setLastResponse] = useState<AgentEventEnqueueResponse | null>(null);

  const enqueueMutation = useMutation({
    mutationFn: async (payload: AgentEventEnqueueRequest) => {
      const response = await apiFetch<unknown>("/agent/event", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return AgentEventEnqueueResponseSchema.parse(response);
    },
    onMutate: payload => {
      setApiState("loading");
      setErrorMessage(null);
      setLastRequest(payload);
      setLastResponse(null);
    },
    onSuccess: response => {
      setApiState("success");
      setLastResponse(response);
    },
    onError: error => {
      setApiState("error");
      setErrorMessage(error instanceof Error ? error.message : "请求失败，请稍后再试。");
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payloadResult = AgentEventEnqueueRequestSchema.safeParse({ message });
    if (!payloadResult.success) {
      setApiState("error");
      setErrorMessage(payloadResult.error.issues[0]?.message ?? "输入不合法");
      return;
    }

    enqueueMutation.mutate(payloadResult.data);
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Agent Event 测试台</h1>
        <p className="text-sm text-muted-foreground">
          调用 POST /api/agent/event，向后端事件队列发送消息。
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-3 rounded-md border p-4">
        <label htmlFor="agent-message" className="text-sm font-medium">
          消息内容
        </label>
        <textarea
          id="agent-message"
          value={message}
          onChange={event => setMessage(event.target.value)}
          placeholder="输入要发送给 agent 的消息"
          className="min-h-32 w-full rounded-md border bg-background p-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={enqueueMutation.isPending}>
            {enqueueMutation.isPending ? "发送中..." : "发送事件"}
          </Button>
          <span className="text-sm text-muted-foreground">状态：{apiState}</span>
        </div>
        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
      </form>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-md border p-4">
          <h2 className="text-sm font-medium">最后一次请求</h2>
          <pre className="max-h-80 overflow-auto rounded bg-muted p-3 text-xs">
            {lastRequest ? formatJson(lastRequest) : "暂无请求"}
          </pre>
        </div>
        <div className="space-y-2 rounded-md border p-4">
          <h2 className="text-sm font-medium">最后一次响应</h2>
          <pre className="max-h-80 overflow-auto rounded bg-muted p-3 text-xs">
            {lastResponse ? formatJson(lastResponse) : "暂无响应"}
          </pre>
        </div>
      </section>
    </div>
  );
}
