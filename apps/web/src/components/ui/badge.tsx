import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// 蒙德里安色块徽章：2px 黑描边 + 填实色，色块内不渐变、不做 hover 淡化
const badgeVariants = cva(
  "inline-flex items-center rounded-none border-foreground px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        destructive: "bg-destructive text-destructive-foreground",
        outline: "text-foreground",
        signal: "bg-signal text-signal-foreground" /* 红 · 错误 · 主动事件 */,
        llm: "bg-llm text-llm-foreground" /* 蓝 · LLM · context */,
        scheduler: "bg-scheduler text-scheduler-foreground" /* 黄 · 等待 · 轮询 */,
        story: "bg-story text-story-foreground" /* 绿 · Story · 记忆 */,
        cost: "bg-cost text-cost-foreground" /* 玫红 · 高成本 · 风险 */,
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
