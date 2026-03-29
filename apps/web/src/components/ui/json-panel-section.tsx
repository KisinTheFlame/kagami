import { AlertCircle, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export type JsonPanelCopyStatus = "idle" | "success" | "error";

export type JsonPanelSectionItem = {
  key: string;
  title: string;
  value: unknown;
  defaultOpen?: boolean;
};

export function JsonPanelSection({
  title,
  items,
  activePanelKey,
  activeCopyStatus,
  onCopy,
}: {
  title: string;
  items: JsonPanelSectionItem[];
  activePanelKey: string | null;
  activeCopyStatus: JsonPanelCopyStatus;
  onCopy: (panelKey: string, text: string) => void;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold">{title}</h3>
      {items.map(item => (
        <JsonPanel
          key={item.key}
          title={item.title}
          value={item.value}
          defaultOpen={item.defaultOpen}
          copyStatus={activePanelKey === item.key ? activeCopyStatus : "idle"}
          onCopy={text => {
            onCopy(item.key, text);
          }}
        />
      ))}
    </section>
  );
}

function JsonPanel({
  title,
  value,
  copyStatus,
  onCopy,
  defaultOpen = false,
}: {
  title: string;
  value: unknown;
  copyStatus: JsonPanelCopyStatus;
  onCopy: (text: string) => void;
  defaultOpen?: boolean;
}) {
  const serializedValue = safeStringify(value);
  const copyButtonLabel =
    copyStatus === "success" ? "已复制" : copyStatus === "error" ? "复制失败" : "复制";

  return (
    <details open={defaultOpen} className="relative rounded-md border bg-muted/20 p-3">
      <summary className="cursor-pointer pr-12 text-sm font-medium">{title}</summary>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={copyButtonLabel}
        title={copyButtonLabel}
        className="absolute right-2 top-1.5 h-8 w-8"
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          onCopy(serializedValue);
        }}
      >
        <CopyStatusIcon status={copyStatus} />
      </Button>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6">
        {serializedValue}
      </pre>
    </details>
  );
}

function CopyStatusIcon({ status }: { status: JsonPanelCopyStatus }) {
  if (status === "success") {
    return <Check className="h-4 w-4" />;
  }

  if (status === "error") {
    return <AlertCircle className="h-4 w-4" />;
  }

  return <Copy className="h-4 w-4" />;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
