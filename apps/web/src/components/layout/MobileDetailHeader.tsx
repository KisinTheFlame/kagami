import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

type MobileDetailHeaderProps = {
  title: string;
  onBack: () => void;
};

export function MobileDetailHeader({ title, onBack }: MobileDetailHeaderProps) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-3">
      <Button type="button" variant="ghost" size="sm" onClick={onBack} className="shrink-0">
        <ArrowLeft className="mr-1 h-4 w-4" />
        返回列表
      </Button>
      <p className="min-w-0 flex-1 truncate text-sm font-medium">{title}</p>
    </div>
  );
}
