/** Playground 的小型展示组件（Panel/Field/StateHint/ToolCallCard/MetaItem）。从 LlmPlaygroundPage.tsx 拆出（纯移动）。 */
import type { ReactNode } from "react";
import type { LlmToolCallPayload } from "@kagami/shared/schemas/llm-chat";
import { formatJson } from "./playground-editor";
export function Panel({
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
    <section className={`rounded-none border bg-card p-5 ${className ?? ""}`}>
      <div className="mb-4 space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block space-y-2 ${className ?? ""}`}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

export function StateHint({
  text,
  tone = "default",
}: {
  text: string;
  tone?: "default" | "warning" | "error";
}) {
  const toneClassName =
    tone === "error"
      ? "border-foreground bg-signal text-signal-foreground"
      : tone === "warning"
        ? "border-foreground bg-scheduler text-scheduler-foreground"
        : "border-dashed bg-muted/20 text-muted-foreground";

  return (
    <div
      className={`flex min-h-[100px] items-center justify-center rounded-none border px-4 py-6 text-center text-sm ${toneClassName}`}
    >
      {text}
    </div>
  );
}

export function ToolCallCard({ toolCall }: { toolCall: LlmToolCallPayload }) {
  return (
    <details className="rounded-none border bg-muted/20 p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {toolCall.name}
        <span className="ml-2 font-mono text-xs text-muted-foreground">{toolCall.id}</span>
      </summary>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-none bg-foreground p-3 font-mono text-xs leading-6 text-background">
        {formatJson(toolCall.arguments)}
      </pre>
    </details>
  );
}

export function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="break-words text-sm font-medium">{value}</p>
    </div>
  );
}
