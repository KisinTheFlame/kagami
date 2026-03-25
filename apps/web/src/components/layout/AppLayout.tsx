import { Menu } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import { RouteLoadingIndicator } from "./RouteLoadingIndicator";
import { Sidebar } from "./Sidebar";
import { getPageTitle } from "./navigation";

export function AppLayout() {
  const location = useLocation();
  const isMobile = useIsMobile();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const pageTitle = getPageTitle(location.pathname);

  useEffect(() => {
    if (!(isSidebarOpen && isMobile)) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobile, isSidebarOpen]);

  useEffect(() => {
    if (!(isSidebarOpen && isMobile)) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsSidebarOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobile, isSidebarOpen]);

  return (
    <div className="relative flex min-h-[100dvh] bg-background md:h-screen">
      <Sidebar className="hidden md:flex" />

      <div className="flex min-h-[100dvh] min-w-0 flex-1 flex-col md:min-h-0">
        <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur md:hidden">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="打开菜单"
            onClick={() => setIsSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight">{pageTitle}</p>
          </div>
        </header>

        <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden pt-14 md:pt-0">
          <Suspense fallback={<RouteLoadingIndicator />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <div
        className={cn(
          "fixed inset-0 z-50 md:hidden",
          isSidebarOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <button
          type="button"
          aria-label="关闭菜单"
          className={cn(
            "absolute inset-0 bg-black/40 transition-opacity",
            isSidebarOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setIsSidebarOpen(false)}
        />
        <Sidebar
          className={cn(
            "absolute left-0 top-0 h-[100dvh] w-72 max-w-[85vw] shadow-lg transition-transform duration-200",
            isSidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
          onNavigate={() => setIsSidebarOpen(false)}
        />
      </div>
    </div>
  );
}
