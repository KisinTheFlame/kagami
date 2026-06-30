import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { navItems } from "./navigation";

type SidebarProps = {
  className?: string;
  onNavigate?: () => void;
};

export function Sidebar({ className, onNavigate }: SidebarProps) {
  const location = useLocation();

  return (
    <aside
      className={cn(
        "flex h-full w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        className,
      )}
    >
      <div className="flex h-14 items-center border-b border-sidebar-active/20 px-4">
        <span className="font-serif text-xl font-semibold tracking-tight text-sidebar-active dark:text-sidebar-active-foreground">
          鏡 Kagami
        </span>
      </div>
      <nav className="flex flex-col gap-1 p-2">
        {navItems.map(({ to, label, icon: Icon, matchPrefixes }) => {
          const isActive =
            location.pathname === to ||
            location.pathname.startsWith(`${to}/`) ||
            matchPrefixes?.some(
              prefix => location.pathname === prefix || location.pathname.startsWith(prefix),
            ) === true;

          return (
            <NavLink
              key={to}
              to={to}
              className={() =>
                cn(
                  "flex min-h-11 items-center gap-3 rounded-none px-3 py-2 text-sm transition-colors md:min-h-0",
                  isActive
                    ? "bg-sidebar-active font-medium text-sidebar-active-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-active/10 hover:text-sidebar-active",
                )
              }
              onClick={onNavigate}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
