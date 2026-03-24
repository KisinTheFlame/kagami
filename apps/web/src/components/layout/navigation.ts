import {
  Database,
  FileText,
  FlaskConical,
  History,
  type LucideIcon,
  KeyRound,
  MessagesSquare,
  Route,
  Webhook,
} from "lucide-react";

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  matchPrefixes?: readonly string[];
};

export const navItems: readonly NavItem[] = [
  { to: "/auth/codex", label: "内置登录", icon: KeyRound, matchPrefixes: ["/auth", "/auth/"] },
  { to: "/llm-playground", label: "LLM Playground", icon: FlaskConical },
  { to: "/llm-history", label: "LLM 调用历史", icon: History },
  { to: "/embedding-cache-history", label: "Embedding 缓存", icon: Database },
  { to: "/app-log-history", label: "应用日志", icon: FileText },
  { to: "/napcat-event-history", label: "NapCat 事件", icon: Webhook },
  { to: "/napcat-group-message-history", label: "群聊消息", icon: MessagesSquare },
  { to: "/loop-runs", label: "Loop 链路回放", icon: Route },
];

export function getPageTitle(pathname: string): string {
  if (pathname === "/loop-runs" || pathname.startsWith("/loop-runs/")) {
    return "Loop 详情";
  }

  const matchedItem = navItems.find(
    ({ to, matchPrefixes }) =>
      pathname === to ||
      pathname.startsWith(`${to}/`) ||
      matchPrefixes?.some(prefix => pathname === prefix || pathname.startsWith(prefix)) === true,
  );
  return matchedItem?.label ?? "Kagami";
}
