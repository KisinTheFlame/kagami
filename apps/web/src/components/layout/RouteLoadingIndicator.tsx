import { LoaderCircle } from "lucide-react";

export function RouteLoadingIndicator() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border bg-background/80 shadow-sm">
        <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
}
