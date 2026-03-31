import {
  Brain,
  Bot,
  FileText,
  FlaskConical,
  History,
  type LucideIcon,
  KeyRound,
  MessagesSquare,
  Webhook,
} from "lucide-react";

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  matchPrefixes?: readonly string[];
};

export const navItems: readonly NavItem[] = [
  { to: "/agent-dashboard", label: "Agent 仪表盘", icon: Bot },
  { to: "/auth/codex", label: "内置登录", icon: KeyRound, matchPrefixes: ["/auth", "/auth/"] },
  { to: "/llm-playground", label: "LLM Playground", icon: FlaskConical },
  { to: "/llm-history", label: "LLM 调用历史", icon: History },
  { to: "/app-log-history", label: "应用日志", icon: FileText },
  { to: "/napcat-event-history", label: "NapCat 事件", icon: Webhook },
  { to: "/napcat-group-message-history", label: "群聊消息", icon: MessagesSquare },
  { to: "/story-history", label: "Story 记忆", icon: Brain },
];

export function getPageTitle(pathname: string): string {
  const matchedItem = navItems.find(
    ({ to, matchPrefixes }) =>
      pathname === to ||
      pathname.startsWith(`${to}/`) ||
      matchPrefixes?.some(prefix => pathname === prefix || pathname.startsWith(prefix)) === true,
  );
  return matchedItem?.label ?? "Kagami";
}
