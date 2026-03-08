import { FileText, FlaskConical, History, MessagesSquare, TestTube2, Webhook } from "lucide-react";

export const navItems = [
  { to: "/llm-playground", label: "LLM Playground", icon: FlaskConical },
  { to: "/llm-history", label: "LLM 调用历史", icon: History },
  { to: "/app-log-history", label: "应用日志", icon: FileText },
  { to: "/napcat-event-history", label: "NapCat 事件", icon: Webhook },
  { to: "/napcat-group-message-history", label: "群聊消息", icon: MessagesSquare },
  { to: "/api-lab", label: "后端接口测试台", icon: TestTube2 },
] as const;

export function getPageTitle(pathname: string): string {
  const matchedItem = navItems.find(({ to }) => pathname === to || pathname.startsWith(`${to}/`));
  return matchedItem?.label ?? "Kagami";
}
