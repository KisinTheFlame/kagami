import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// 语义色调：数字本身着色（配给不涂抹），底仍中性，符合 DESIGN.md「饱和色只落在活着的数据上」。
export type StatTone = "neutral" | "llm" | "cost" | "signal";

const TONE_CLASS: Record<StatTone, string> = {
  neutral: "text-foreground",
  llm: "text-[hsl(var(--llm))]",
  cost: "text-[hsl(var(--cost))]",
  signal: "text-[hsl(var(--signal))]",
};

type StatCardProps = {
  label: string;
  value: string;
  hint?: string;
  tone?: StatTone;
  isLoading?: boolean;
};

/** 单值卡（stat panel）：观察台三种图元之一。加载时占位破折号，永不白屏。 */
export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
  isLoading = false,
}: StatCardProps) {
  return (
    <Card className="rounded-none">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("mt-1 font-serif text-2xl font-semibold tabular-nums", TONE_CLASS[tone])}>
          {isLoading ? "—" : value}
        </p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
