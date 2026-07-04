import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ObservabilityPanelProps = {
  title: string;
  description?: string;
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  emptyLabel?: string;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
};

/**
 * 观察台面板外壳：统一处理 加载 / 错误 / 空 三态，避免各面板各写一遍、且永不白屏。
 * 这是「富图表原语」里最薄的那层——只管状态与标题，具体图交给 children。
 */
export function ObservabilityPanel({
  title,
  description,
  isLoading,
  isError,
  isEmpty,
  emptyLabel = "该时间范围内暂无数据",
  actions,
  className,
  bodyClassName,
  children,
}: ObservabilityPanelProps) {
  return (
    <Card className={cn("rounded-none", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </CardHeader>
      <CardContent className={cn("min-h-[8rem]", bodyClassName)}>
        <PanelBody
          isLoading={isLoading}
          isError={isError}
          isEmpty={isEmpty}
          emptyLabel={emptyLabel}
        >
          {children}
        </PanelBody>
      </CardContent>
    </Card>
  );
}

function PanelBody({
  isLoading,
  isError,
  isEmpty,
  emptyLabel,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  emptyLabel: string;
  children: ReactNode;
}) {
  if (isError) {
    return <PanelNotice className="text-signal">加载失败</PanelNotice>;
  }
  if (isLoading) {
    return <PanelNotice>加载中…</PanelNotice>;
  }
  if (isEmpty) {
    return <PanelNotice>{emptyLabel}</PanelNotice>;
  }
  return <>{children}</>;
}

function PanelNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex h-32 items-center justify-center text-sm text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
