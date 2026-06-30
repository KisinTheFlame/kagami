import { LoaderCircle } from "lucide-react";

export function RouteLoadingIndicator() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-none border bg-card">
        <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
}
