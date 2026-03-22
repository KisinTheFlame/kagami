import {
  Database,
  FileText,
  FlaskConical,
  History,
  KeyRound,
  MessagesSquare,
  Route,
  Webhook,
} from "lucide-react";

export const navItems = [
  { to: "/claude-code-auth", label: "Claude Code 登录", icon: KeyRound },
  { to: "/codex-auth", label: "Codex 登录", icon: KeyRound },
  { to: "/llm-playground", label: "LLM Playground", icon: FlaskConical },
  { to: "/llm-history", label: "LLM 调用历史", icon: History },
  { to: "/embedding-cache-history", label: "Embedding 缓存", icon: Database },
  { to: "/app-log-history", label: "应用日志", icon: FileText },
  { to: "/napcat-event-history", label: "NapCat 事件", icon: Webhook },
  { to: "/napcat-group-message-history", label: "群聊消息", icon: MessagesSquare },
  { to: "/loop-runs", label: "Loop 链路回放", icon: Route },
] as const;

export function getPageTitle(pathname: string): string {
  if (pathname === "/loop-runs" || pathname.startsWith("/loop-runs/")) {
    return "Loop 详情";
  }

  const matchedItem = navItems.find(({ to }) => pathname === to || pathname.startsWith(`${to}/`));
  return matchedItem?.label ?? "Kagami";
}
