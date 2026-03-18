import { Database, FileText, FlaskConical, History, MessagesSquare, Webhook } from "lucide-react";

export const navItems = [
  { to: "/llm-playground", label: "LLM Playground", icon: FlaskConical },
  { to: "/llm-history", label: "LLM 调用历史", icon: History },
  { to: "/embedding-cache-history", label: "Embedding 缓存", icon: Database },
  { to: "/app-log-history", label: "应用日志", icon: FileText },
  { to: "/napcat-event-history", label: "NapCat 事件", icon: Webhook },
  { to: "/napcat-group-message-history", label: "群聊消息", icon: MessagesSquare },
] as const;

export function getPageTitle(pathname: string): string {
  const matchedItem = navItems.find(({ to }) => pathname === to || pathname.startsWith(`${to}/`));
  return matchedItem?.label ?? "Kagami";
}
