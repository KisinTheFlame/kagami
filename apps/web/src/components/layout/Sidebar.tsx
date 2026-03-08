import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { navItems } from "./navigation";

type SidebarProps = {
  className?: string;
  onNavigate?: () => void;
};

export function Sidebar({ className, onNavigate }: SidebarProps) {
  return (
    <aside className={cn("flex h-full w-56 shrink-0 flex-col border-r bg-background", className)}>
      <div className="flex h-14 items-center border-b px-4">
        <span className="text-base font-semibold tracking-tight">Kagami</span>
      </div>
      <nav className="flex flex-col gap-1 p-2">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )
            }
            onClick={onNavigate}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
