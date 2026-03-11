import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

type MobileDetailHeaderProps = {
  title: string;
  onBack: () => void;
};

export function MobileDetailHeader({ title, onBack }: MobileDetailHeaderProps) {
  return (
    <>
      <div className="h-14 md:hidden" aria-hidden />
      <div className="fixed inset-x-0 top-14 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur md:static md:top-auto md:z-auto md:h-auto md:bg-background md:px-3 md:py-3 md:backdrop-blur-none">
        <Button type="button" variant="ghost" size="sm" onClick={onBack} className="shrink-0">
          <ArrowLeft className="mr-1 h-4 w-4" />
          返回列表
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{title}</p>
      </div>
    </>
  );
}
