import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("页面渲染发生未捕获错误。", error, errorInfo);
  }

  private readonly handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error !== null) {
      return (
        <div className="flex h-full min-h-[240px] flex-1 items-center justify-center px-6">
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <div className="space-y-2">
              <p className="text-base font-semibold text-foreground">页面出错了</p>
              <p className="break-words text-sm text-muted-foreground">
                {error.message || "渲染过程中发生未知错误。"}
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={this.handleRetry}>
              重试
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
