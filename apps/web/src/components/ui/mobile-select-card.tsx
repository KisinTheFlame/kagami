import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type MobileSelectCardProps = {
  isSelected?: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function MobileSelectCard({
  className,
  isSelected = false,
  children,
  type = "button",
  ...props
}: MobileSelectCardProps) {
  return (
    <button
      type={type}
      className={cn(
        "w-full rounded-none border px-4 py-3 text-left ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        isSelected
          ? "border-primary bg-accent"
          : "border-border bg-background hover:border-primary hover:bg-accent/60",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
