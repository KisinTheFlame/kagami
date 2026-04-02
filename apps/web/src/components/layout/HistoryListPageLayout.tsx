import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MobileDetailHeader } from "./MobileDetailHeader";

type HistoryListPageLayoutProps = {
  filterForm: ReactNode;
  desktopList: ReactNode;
  mobileList: ReactNode;
  detailPanel: ReactNode;
  detailTitle: string;
  isMobile: boolean;
  showMobileDetail: boolean;
  isError: boolean;
  errorMessage?: string;
  page: number;
  total: number;
  totalPages: number;
  isPaginationDisabled?: boolean;
  onPrevPage: () => void;
  onNextPage: () => void;
  onBackToList: () => void;
};

export function HistoryListPageLayout({
  filterForm,
  desktopList,
  mobileList,
  detailPanel,
  detailTitle,
  isMobile,
  showMobileDetail,
  isError,
  errorMessage = "加载失败，请检查后端服务是否运行。",
  page,
  total,
  totalPages,
  isPaginationDisabled = false,
  onPrevPage,
  onNextPage,
  onBackToList,
}: HistoryListPageLayoutProps) {
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden p-3 md:p-6">
      {filterForm}

      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 md:mt-4 md:gap-4 xl:flex-row">
        <section
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col gap-3 md:gap-4",
            showMobileDetail && "hidden",
          )}
        >
          {isError ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
          {isMobile ? mobileList : desktopList}

          <div className="flex flex-wrap items-center justify-center gap-2 sm:flex-nowrap">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isPaginationDisabled}
              onClick={onPrevPage}
            >
              <ChevronLeft className="h-4 w-4" />
              上一页
            </Button>
            <span className="text-sm text-muted-foreground">第 {page} 页</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isPaginationDisabled}
              onClick={onNextPage}
            >
              下一页
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              共 {total} 条，{totalPages} 页
            </span>
          </div>
        </section>

        <aside
          className={cn(
            "min-w-0 rounded-md border bg-background",
            showMobileDetail
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : isMobile
                ? "hidden"
                : "flex min-h-[160px] w-full flex-col overflow-hidden md:h-[40%] xl:h-full xl:min-h-0 xl:w-auto xl:flex-1",
          )}
        >
          {showMobileDetail ? (
            <MobileDetailHeader title={detailTitle} onBack={onBackToList} />
          ) : null}
          <div className="min-h-0 flex-1 overflow-hidden">{detailPanel}</div>
        </aside>
      </div>
    </div>
  );
}
